import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { getTopDailyPicks } from '@/lib/algorithms/value-bet-calculator';
import { sendDailyPicksTelegram, sendPickAlertTelegram } from '@/lib/notifications/telegram';
import { createClient } from '@supabase/supabase-js';

// ── Admin Supabase (para guardar los picks enviados y no repetir) ─────────────
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Verifica si ya enviamos notificaciones hoy (para no spamear).
 */
async function alreadySentToday(): Promise<boolean> {
  try {
    const supabase = getAdminClient();
    const today    = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const { data } = await supabase
      .from('notification_log')
      .select('id')
      .eq('sent_date', today)
      .eq('type', 'daily_picks')
      .maybeSingle();

    return !!data;
  } catch {
    return false; // Si hay error, mejor enviar que no enviar
  }
}

/**
 * Registra que ya enviamos las notificaciones de hoy.
 */
async function logNotificationSent(picksCount: number): Promise<void> {
  try {
    const supabase = getAdminClient();
    const today    = new Date().toISOString().split('T')[0];

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

/**
 * Cron diario de notificaciones de picks.
 *
 * Flujo:
 *   1. Verifica que no se haya enviado ya hoy
 *   2. Obtiene los eventos con cuotas de la API
 *   3. Calcula los top 5-10 picks del día con getTopDailyPicks
 *   4. Envía el digest completo por Telegram
 *   5. Si hay picks de alta confianza, envía también alertas individuales
 */
export async function GET(request: Request) {
  // Validar que venga del cron de Vercel
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Anti-spam: no enviar más de una vez al día
    const alreadySent = await alreadySentToday();
    if (alreadySent) {
      console.log('[send-picks] Ya se enviaron notificaciones hoy, saltando...');
      return NextResponse.json({ ok: true, skipped: true, reason: 'Already sent today' });
    }

    // 2. Obtener eventos y calcular picks
    console.log('[send-picks] Obteniendo partidos del día...');
    const events = await getUpcomingMatches('upcoming');

    if (events.length === 0) {
      console.log('[send-picks] Sin eventos disponibles hoy');
      return NextResponse.json({ ok: true, skipped: true, reason: 'No events available' });
    }

    // 3. Calcular los mejores picks del día (5-10, con filtro de calidad)
    const topPicks = getTopDailyPicks(events, {
      minPicks:             5,
      maxPicks:             10,
      requireHighConfidence: false, // incluir también confianza media
    });

    if (topPicks.length === 0) {
      console.log('[send-picks] Sin picks de calidad suficiente hoy');
      return NextResponse.json({ ok: true, skipped: true, reason: 'No quality picks today' });
    }

    console.log(`[send-picks] ${topPicks.length} picks calculados. Enviando notificaciones...`);

    // 4. Enviar digest diario por Telegram
    const telegramResult = await sendDailyPicksTelegram(topPicks);
    if (!telegramResult.ok) {
      console.error('[send-picks] Error enviando digest Telegram:', telegramResult.error);
    }

    // 5. Alertas individuales para picks de alta confianza (con Pinnacle align)
    const alertPicks = topPicks.filter(p =>
      p.confidence === 'alta' && p.pinnacleAligns && p.valuePercentage >= 5
    );

    let alertsSent = 0;
    for (const pick of alertPicks.slice(0, 3)) { // máx 3 alertas para no spamear
      await new Promise(r => setTimeout(r, 500)); // espera 0.5s entre mensajes
      const alertResult = await sendPickAlertTelegram(pick);
      if (alertResult.ok) alertsSent++;
    }

    // 6. Registrar en BD
    await logNotificationSent(topPicks.length);

    return NextResponse.json({
      ok:           true,
      picksFound:   topPicks.length,
      digestSent:   telegramResult.ok,
      alertsSent,
      timestamp:    new Date().toISOString(),
    });

  } catch (error) {
    console.error('[send-picks] Error general:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
