import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { getLatestEventsFromSnapshot, saveOddsSnapshot, detectSteamMoves } from '@/app/actions/snapshots';
import {
  getSmartPicks,
  enrichPicksWithStats,
  isTodayInMexico,
  diagnoseEventsFunnel,
} from '@/lib/algorithms/value-bet-calculator';
import {
  sendPreGameAlertTelegram,
  sendSystemHealthAlertTelegram,
  sendScannerHeartbeatTelegram,
} from '@/lib/notifications/telegram';
import {
  saveSentPicks,
  getTodaySentPicks,
  filterDeduplicatedPicks,
} from '@/lib/store/sent-picks';

// ── Configuración Institucional ────────────────────────────────────────────────

/** Ventana pre-partido intra-día (próximas 12 horas o partidos restantes de hoy) */
const HOURS_AHEAD = 12;

/** Mínimo de EV% para enviar una alerta intra-día (o confianza 'alta' / Steam Move) */
const MIN_ALERT_VALUE = 3.5;

/** Máximo de alertas por ejecución del cron */
const MAX_ALERTS_PER_RUN = 4;

export const maxDuration = 60;

function isAuthorizedCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const url = new URL(request.url);
  const querySecret = url.searchParams.get('secret');
  if (querySecret === cronSecret) return true;

  return false;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const isDebug = url.searchParams.get('debug') === 'true';
  const isDryRun = url.searchParams.get('dryRun') === 'true';

  const timestamp = new Date().toISOString();
  const telegramErrors: string[] = [];

  try {
    console.log(`[alert-picks] 🔍 Scanner iniciado (debug=${isDebug}, dryRun=${isDryRun})...`);

    // 1. Obtener eventos desde snapshot (máx 4h de antigüedad)
    const snapshotResult = await getLatestEventsFromSnapshot(4);
    let finalEvents = snapshotResult.events;
    let usedLiveApiFallback = false;

    const now = Date.now();
    const cutoff = now + HOURS_AHEAD * 60 * 60 * 1000;

    const filterValidFutureWindow = (evts: typeof finalEvents) =>
      evts.filter(e => {
        const startMs = new Date(e.commence_time).getTime();
        if (startMs <= now) return false;
        return startMs <= cutoff || isTodayInMexico(e.commence_time);
      });

    let upcomingWindow = filterValidFutureWindow(finalEvents);

    // Si el snapshot es antiguo, está vacío o tiene 0 partidos futuros en la ventana, disparar actualización en vivo
    if (!snapshotResult.fresh || finalEvents.length === 0 || upcomingWindow.length === 0) {
      console.warn(
        `[alert-picks] Snapshot insuficiente (fresh=${snapshotResult.fresh}, age=${snapshotResult.snapshotAge}m, window=${upcomingWindow.length}). Consultando The Odds API en vivo...`
      );
      usedLiveApiFallback = true;
      const liveEvents = await getUpcomingMatches('upcoming');
      if (liveEvents.length > 0) {
        finalEvents = liveEvents;
        await saveOddsSnapshot(liveEvents, true);
        upcomingWindow = filterValidFutureWindow(finalEvents);
      }
    }

    const step1_events_fetched = finalEvents.length;
    const allFutureEvents = finalEvents.filter(e => new Date(e.commence_time).getTime() > now);

    // Si hay 0 partidos futuros en total (ni en snapshot ni en API), enviar Alerta de Salud del Sistema
    if (allFutureEvents.length === 0) {
      const healthMsg = `step1_events_fetched=${step1_events_fetched}, snapshotAge=${snapshotResult.snapshotAge ?? 'null'}min`;
      console.error(`[alert-picks] ⚠️ 0 partidos futuros válidos (${healthMsg})`);
      if (!isDryRun) {
        const healthRes = await sendSystemHealthAlertTelegram(healthMsg);
        if (!healthRes.ok && healthRes.error) {
          telegramErrors.push(healthRes.error);
        }
      }

      const emptyDiagnostics = {
        timestamp,
        step1_events_fetched,
        step2_future_events_valid: 0,
        step3_value_bets_calculated: 0,
        step4_passed_threshold_filters: 0,
        step5_after_deduplication: 0,
        step6_telegram_dispatched: 0,
        telegram_errors: telegramErrors,
        discard_reasons_summary: {
          missing_sharp_book: 0,
          ev_too_low: 0,
          already_sent: 0,
        },
      };

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'No future events available — System Health Alert triggered',
        ...emptyDiagnostics,
        funnel_diagnostics: emptyDiagnostics,
      });
    }

    // Si en la ventana de 12h no hubo pero sí hay futuros en las próximas 24h, ampliar a 24h
    if (upcomingWindow.length === 0) {
      const cutoff24h = now + 24 * 60 * 60 * 1000;
      upcomingWindow = allFutureEvents.filter(
        e => new Date(e.commence_time).getTime() <= cutoff24h
      );
    }

    const step2_future_events_valid = upcomingWindow.length;

    // 2. Diagnóstico del embudo y cálculo cuantitativo (Power Devigging + Sharp Consensus)
    const diagnosis = diagnoseEventsFunnel(upcomingWindow, MIN_ALERT_VALUE);
    let picks = getSmartPicks(upcomingWindow, true);

    // 3. Detectar Steam Moves (caídas bruscas de cuota en casas sharp)
    const { steamMap } = await detectSteamMoves(upcomingWindow);
    picks = picks.map(p => {
      const cleanPick = p.bestPick.replace(/🔥/g, '').trim();
      const steam = steamMap.get(`${p.eventId}::${cleanPick}`);
      if (steam) {
        return {
          ...p,
          isSteamMove: true,
          steamMoveDelta: steam.impliedProbDeltaPct,
        };
      }
      return p;
    });

    // 3.5 Enriquecer con proveedores secundarios (aislado con timeout < 3s y degradación elegante)
    picks = await enrichPicksWithStats(picks);

    const step3_value_bets_calculated = picks.length;

    // 4. Filtrar por calidad: confianza 'alta' O EV >= MIN_ALERT_VALUE% O Steam Move
    const qualityPicks = picks.filter(
      p => p.confidence === 'alta' || p.valuePercentage >= MIN_ALERT_VALUE || p.isSteamMove
    );
    const step4_passed_threshold_filters = qualityPicks.length;

    // 5. Deduplicación determinista (match_id + market + selection, re-alerta si EV sube >= 2.5%)
    const alreadySent = await getTodaySentPicks();
    const {
      allowedPicks: newPicks,
      alreadySentCount,
      upgradedEvCount,
    } = filterDeduplicatedPicks(qualityPicks, alreadySent);

    const step5_after_deduplication = newPicks.length;

    const discard_reasons_summary = {
      missing_sharp_book: diagnosis.discardReasons.missing_sharp_book,
      ev_too_low: diagnosis.discardReasons.ev_too_low + diagnosis.discardReasons.odds_out_of_zone,
      already_sent: alreadySentCount,
      insufficient_bookmakers: diagnosis.discardReasons.insufficient_bookmakers,
    };

    // 6. Despacho a Telegram
    const toSend = newPicks.slice(0, MAX_ALERTS_PER_RUN);
    let step6_telegram_dispatched = 0;
    let heartbeat_sent = false;
    const sentPicks = [];

    if (!isDryRun) {
      if (toSend.length > 0) {
        for (const pick of toSend) {
          if (step6_telegram_dispatched > 0) {
            await new Promise(r => setTimeout(r, 400));
          }

          const result = await sendPreGameAlertTelegram(pick);
          if (result.ok) {
            step6_telegram_dispatched++;
            sentPicks.push(pick);
          } else {
            const errStr = result.error ?? 'Unknown Telegram error';
            telegramErrors.push(`${pick.event}: ${errStr}`);
            console.error(`[alert-picks] Error enviando alerta para ${pick.event}:`, errStr);
          }
        }

        if (sentPicks.length > 0) {
          await saveSentPicks(sentPicks, 'pre_game_alert');
        }
      } else {
        // Enviar reporte silencioso (sin sonido/vibración) cuando no hay picks nuevos de valor
        const hbRes = await sendScannerHeartbeatTelegram({
          step1Events: step1_events_fetched,
          step2WindowEvents: step2_future_events_valid,
          step3Candidates: step3_value_bets_calculated,
          step4PassedQuality: step4_passed_threshold_filters,
          alreadySentCount,
          evTooLowCount: discard_reasons_summary.ev_too_low,
          snapshotAgeMins: snapshotResult.snapshotAge,
        });
        heartbeat_sent = hbRes.ok;
        if (!hbRes.ok && hbRes.error) {
          telegramErrors.push(`Heartbeat: ${hbRes.error}`);
        }
      }
    }

    const funnel_diagnostics = {
      timestamp,
      used_live_api_fallback: usedLiveApiFallback,
      snapshot_age_minutes: snapshotResult.snapshotAge,
      dry_run: isDryRun,
      heartbeat_sent,
      step1_events_fetched,
      step2_future_events_valid,
      step3_value_bets_calculated,
      step4_passed_threshold_filters,
      step5_after_deduplication,
      step6_telegram_dispatched,
      upgraded_ev_realerts: upgradedEvCount,
      telegram_errors: telegramErrors,
      discard_reasons_summary,
      ...(isDebug
        ? {
            candidate_picks_preview: qualityPicks.slice(0, 10).map(p => ({
              eventId: p.eventId,
              event: p.event,
              pick: p.bestPick,
              market: p.bestMarket,
              bestOdds: p.bestOdds,
              fairOdds: p.fairOdds,
              bookmaker: p.bestBookmaker,
              evPct: Number(p.valuePercentage.toFixed(2)),
              kellyPct: p.kellyStake,
              confidence: p.confidence,
              pinnacleAligns: p.pinnacleAligns,
              isSteamMove: !!p.isSteamMove,
            })),
          }
        : {}),
    };

    console.log(
      `[alert-picks] ✅ Embudo completado: step1=${step1_events_fetched} -> step2=${step2_future_events_valid} -> step3=${step3_value_bets_calculated} -> step4=${step4_passed_threshold_filters} -> step5=${step5_after_deduplication} -> step6=${step6_telegram_dispatched}`
    );

    return NextResponse.json({
      ok: true,
      scanned: step2_future_events_valid,
      qualityPicks: step4_passed_threshold_filters,
      newPicks: step5_after_deduplication,
      alertsSent: step6_telegram_dispatched,
      ...funnel_diagnostics,
      funnel_diagnostics,
    });
  } catch (error) {
    console.error('[alert-picks] Error general:', error);
    return NextResponse.json(
      {
        ok: false,
        error: String(error),
        timestamp,
        telegram_errors: telegramErrors,
      },
      { status: 500 }
    );
  }
}
