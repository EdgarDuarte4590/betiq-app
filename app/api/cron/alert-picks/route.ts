import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { getLatestEventsFromSnapshot } from '@/app/actions/snapshots';
import { getSmartPicks, enrichPicksWithStats, isTodayInMexico } from '@/lib/algorithms/value-bet-calculator';
import { sendPreGameAlertTelegram } from '@/lib/notifications/telegram';
import { saveSentPicks, getTodaySentPicks } from '@/lib/store/sent-picks';

// ── Configuración ──────────────────────────────────────────────────────────────

/** Solo alertar partidos que empiezan en las próximas N horas */
const HOURS_AHEAD = 4;

/** Mínimo de value% para enviar una alerta intra-día */
const MIN_ALERT_VALUE = 8;

/** Máximo de alertas por ejecución del cron (para no spamear) */
const MAX_ALERTS_PER_RUN = 3;

/**
 * Cron de alertas pre-partido (intra-día).
 *
 * Se ejecuta cada 3 horas (12pm, 3pm, 6pm, 9pm CST).
 * Busca oportunidades de alta calidad para partidos próximos que
 * NO hayan sido enviadas en el digest matutino ni en alertas anteriores.
 *
 * Criterios para alertar:
 *   - Partido se juega HOY
 *   - Partido empieza en las próximas 4 horas
 *   - Confianza 'alta' O value% >= 8%
 *   - No fue enviado previamente (deduplicación contra sent_picks)
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  // Validar que venga del cron de Vercel
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[alert-picks] 🔍 Scanner de alertas pre-partido iniciado...');

    // 1. Obtener eventos — preferir snapshot para ahorrar API requests
    const { events, fresh, snapshotAge } = await getLatestEventsFromSnapshot();

    let finalEvents = events;
    if (!fresh || finalEvents.length === 0) {
      console.warn(`[alert-picks] Snapshot no disponible (age=${snapshotAge}min). Llamando a The Odds API...`);
      finalEvents = await getUpcomingMatches('upcoming');
    } else {
      console.log(`[alert-picks] ✅ Usando snapshot (${snapshotAge}min antigüedad, ${finalEvents.length} eventos).`);
    }

    if (finalEvents.length === 0) {
      console.log('[alert-picks] Sin eventos disponibles');
      return NextResponse.json({ ok: true, skipped: true, reason: 'No events' });
    }

    // 2. Filtrar: solo partidos de HOY que empiezan en las próximas N horas
    const now = Date.now();
    const cutoff = now + HOURS_AHEAD * 60 * 60 * 1000;

    const upcomingToday = finalEvents.filter(e => {
      if (!isTodayInMexico(e.commence_time)) return false;
      const startMs = new Date(e.commence_time).getTime();
      return startMs > now && startMs <= cutoff;
    });

    if (upcomingToday.length === 0) {
      console.log(`[alert-picks] Sin partidos de hoy en las próximas ${HOURS_AHEAD}h`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'No upcoming matches in window' });
    }

    console.log(`[alert-picks] ${upcomingToday.length} partidos de hoy en las próximas ${HOURS_AHEAD}h`);

    // 3. Calcular smart picks para estos partidos
    let picks = getSmartPicks(upcomingToday, true);
    picks = await enrichPicksWithStats(picks);

    // 4. Filtrar por calidad: confianza alta O value >= MIN_ALERT_VALUE%
    const qualityPicks = picks.filter(p =>
      p.confidence === 'alta' || p.valuePercentage >= MIN_ALERT_VALUE
    );

    if (qualityPicks.length === 0) {
      console.log('[alert-picks] Sin picks de suficiente calidad para alertar');
      return NextResponse.json({ ok: true, skipped: true, reason: 'No quality picks' });
    }

    // 5. Deduplicar: excluir picks que ya se enviaron hoy (digest o alertas previas)
    const alreadySent = await getTodaySentPicks();
    const sentKeys = new Set(alreadySent.map(s => `${s.event_id}::${s.pick_label}`));

    const newPicks = qualityPicks.filter(p =>
      !sentKeys.has(`${p.eventId}::${p.bestPick}`)
    );

    if (newPicks.length === 0) {
      console.log('[alert-picks] Todos los picks de calidad ya fueron enviados hoy');
      return NextResponse.json({ ok: true, skipped: true, reason: 'All picks already sent' });
    }

    console.log(`[alert-picks] ${newPicks.length} picks nuevos detectados. Enviando hasta ${MAX_ALERTS_PER_RUN}...`);

    // 6. Enviar alertas individuales (máx MAX_ALERTS_PER_RUN)
    const toSend = newPicks.slice(0, MAX_ALERTS_PER_RUN);
    let alertsSent = 0;
    const sentPicks = [];

    for (const pick of toSend) {
      // Esperar un poco entre mensajes para no saturar la API de Telegram
      if (alertsSent > 0) {
        await new Promise(r => setTimeout(r, 500));
      }

      const result = await sendPreGameAlertTelegram(pick);
      if (result.ok) {
        alertsSent++;
        sentPicks.push(pick);
      } else {
        console.error(`[alert-picks] Error enviando alerta para ${pick.event}:`, result.error);
      }
    }

    // 7. Guardar los picks enviados para deduplicación futura
    if (sentPicks.length > 0) {
      await saveSentPicks(sentPicks, 'pre_game_alert');
    }

    console.log(`[alert-picks] ✅ ${alertsSent}/${toSend.length} alertas enviadas`);

    return NextResponse.json({
      ok:           true,
      scanned:      upcomingToday.length,
      qualityPicks: qualityPicks.length,
      newPicks:     newPicks.length,
      alertsSent,
      timestamp:    new Date().toISOString(),
    });

  } catch (error) {
    console.error('[alert-picks] Error general:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
