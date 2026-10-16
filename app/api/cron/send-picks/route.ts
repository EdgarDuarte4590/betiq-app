import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { getLatestEventsFromSnapshot, saveOddsSnapshot, detectSteamMoves } from '@/app/actions/snapshots';
import { getTopDailyPicks, enrichPicksWithStats, isTodayInMexico, diagnoseEventsFunnel } from '@/lib/algorithms/value-bet-calculator';
import {
  sendDailyPicksTelegram,
  sendPickAlertTelegram,
  sendNoPicksTelegram,
  sendSystemHealthAlertTelegram,
} from '@/lib/notifications/telegram';
import { saveSentPicks } from '@/lib/store/sent-picks';
import { createAdminClient } from '@/lib/supabase/admin';

function getTodayMexico(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

async function alreadySentToday(): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const today    = getTodayMexico();

    const { data } = await supabase
      .from('notification_log')
      .select('id, picks_count')
      .eq('sent_date', today)
      .eq('type', 'daily_picks')
      .maybeSingle();

    // Si hoy solo se registró picks_count = 0 por un snapshot vacío previo, permitir reintento si hay picks reales
    if (!data) return false;
    return (data.picks_count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function logNotificationSent(picksCount: number): Promise<void> {
  try {
    const supabase = createAdminClient();
    const today    = getTodayMexico();

    await supabase.from('notification_log').upsert({
      sent_date:   today,
      type:        'daily_picks',
      picks_count: picksCount,
      sent_at:     new Date().toISOString(),
    }, { onConflict: 'sent_date,type' });
  } catch (err) {
    console.warn('[send-picks] No se pudo registrar en notification_log:', err);
  }
}

function isAuthorizedCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('secret') === cronSecret) return true;

  return false;
}

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const forceSend = url.searchParams.get('force') === 'true';
  const isDebug = url.searchParams.get('debug') === 'true';
  const isDryRun = url.searchParams.get('dryRun') === 'true';
  const timestamp = new Date().toISOString();
  const telegramErrors: string[] = [];

  try {
    if (!forceSend && !isDebug && !isDryRun) {
      const alreadySent = await alreadySentToday();
      if (alreadySent) {
        console.log('[send-picks] Ya se enviaron notificaciones con picks hoy, saltando...');
        return NextResponse.json({ ok: true, skipped: true, reason: 'Already sent today', timestamp });
      }
    }

    console.log('[send-picks] Leyendo partidos desde snapshot de Supabase...');
    const snapshotResult = await getLatestEventsFromSnapshot(5);

    let finalEvents = snapshotResult.events;
    const now = Date.now();
    let todayFutureEvents = finalEvents.filter(
      e => isTodayInMexico(e.commence_time) && new Date(e.commence_time).getTime() > now
    );

    if (!snapshotResult.fresh || finalEvents.length === 0 || todayFutureEvents.length === 0) {
      console.warn(`[send-picks] Snapshot insuficiente (age=${snapshotResult.snapshotAge}min, todayFuture=${todayFutureEvents.length}). Llamando a The Odds API...`);
      const liveEvents = await getUpcomingMatches('upcoming');
      if (liveEvents.length > 0) {
        finalEvents = liveEvents;
        await saveOddsSnapshot(liveEvents, true);
        todayFutureEvents = finalEvents.filter(
          e => isTodayInMexico(e.commence_time) && new Date(e.commence_time).getTime() > now
        );
      }
    }

    const step1_events_fetched = finalEvents.length;
    const step2_future_events_valid = todayFutureEvents.length;

    if (finalEvents.length === 0) {
      if (!isDryRun) {
        await sendSystemHealthAlertTelegram('send-picks: 0 eventos obtenidos de snapshot y API');
      }
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'No events available',
        timestamp,
        step1_events_fetched: 0,
        step2_future_events_valid: 0,
      });
    }

    const diagnosis = diagnoseEventsFunnel(todayFutureEvents.length > 0 ? todayFutureEvents : finalEvents, 2.0);

    let topPicks = getTopDailyPicks(finalEvents, {
      minPicks:              1,
      maxPicks:              10,
      requireHighConfidence: false,
      todayOnly:             todayFutureEvents.length > 0,
    });

    const step3_value_bets_calculated = topPicks.length;

    if (topPicks.length === 0) {
      console.log('[send-picks] Sin picks de calidad suficiente hoy. Enviando aviso...');
      let digestOk = false;
      if (!isDryRun) {
        const telegramResult = await sendNoPicksTelegram(finalEvents.length);
        digestOk = telegramResult.ok;
        if (!telegramResult.ok && telegramResult.error) telegramErrors.push(telegramResult.error);
        await logNotificationSent(0);
      }

      const funnel_diagnostics = {
        timestamp,
        step1_events_fetched,
        step2_future_events_valid,
        step3_value_bets_calculated: 0,
        step4_passed_threshold_filters: 0,
        step5_after_deduplication: 0,
        step6_telegram_dispatched: digestOk ? 1 : 0,
        telegram_errors: telegramErrors,
        discard_reasons_summary: diagnosis.discardReasons,
      };

      return NextResponse.json({
        ok: true,
        picksFound: 0,
        digestSent: digestOk,
        reason: 'No quality picks today',
        ...funnel_diagnostics,
        funnel_diagnostics,
      });
    }

    // Detectar Steam Moves
    const { steamMap } = await detectSteamMoves(finalEvents);
    topPicks = topPicks.map(p => {
      const cleanPick = p.bestPick.replace(/🔥/g, '').trim();
      const steam = steamMap.get(`${p.eventId}::${cleanPick}`);
      if (steam) {
        return { ...p, isSteamMove: true, steamMoveDelta: steam.impliedProbDeltaPct };
      }
      return p;
    });

    // Enriquecer con proveedores secundarios (aislado con timeout < 3s)
    topPicks = await enrichPicksWithStats(topPicks);

    let digestSent = false;
    let alertsSent = 0;

    if (!isDryRun) {
      const telegramResult = await sendDailyPicksTelegram(topPicks);
      digestSent = telegramResult.ok;
      if (!telegramResult.ok && telegramResult.error) {
        telegramErrors.push(telegramResult.error);
      }

      const alertPicks = topPicks.filter(
        p => p.confidence === 'alta' && p.pinnacleAligns && p.valuePercentage >= 4.5
      );

      for (const pick of alertPicks.slice(0, 3)) {
        await new Promise(r => setTimeout(r, 400));
        const alertResult = await sendPickAlertTelegram(pick);
        if (alertResult.ok) {
          alertsSent++;
        } else if (alertResult.error) {
          telegramErrors.push(alertResult.error);
        }
      }

      await logNotificationSent(topPicks.length);
      await saveSentPicks(topPicks, 'daily_digest');
    }

    const funnel_diagnostics = {
      timestamp,
      step1_events_fetched,
      step2_future_events_valid,
      step3_value_bets_calculated,
      step4_passed_threshold_filters: topPicks.length,
      step5_after_deduplication: topPicks.length,
      step6_telegram_dispatched: (digestSent ? 1 : 0) + alertsSent,
      telegram_errors: telegramErrors,
      discard_reasons_summary: diagnosis.discardReasons,
    };

    return NextResponse.json({
      ok: true,
      picksFound: topPicks.length,
      digestSent,
      alertsSent,
      ...funnel_diagnostics,
      funnel_diagnostics,
    });
  } catch (error) {
    console.error('[send-picks] Error general:', error);
    return NextResponse.json({ error: String(error), timestamp }, { status: 500 });
  }
}
