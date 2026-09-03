import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { saveOddsSnapshot } from '@/app/actions/snapshots';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60; // Permitir que el cron dure hasta 60s en Vercel Hobby

// El único lugar donde se llama a The Odds API. El Dashboard lee desde odds_snapshots.
const MIN_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas mínimo entre refreshes

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Rate limit: verificar si ya hay un snapshot reciente ──
  try {
    const supabase = await createClient();
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow?.recorded_at) {
      const ageMs = Date.now() - new Date(latestRow.recorded_at).getTime();
      const ageMin = Math.round(ageMs / 60000);
      if (ageMs < MIN_REFRESH_INTERVAL_MS) {
        console.log(`[Cron/refresh-odds] Snapshot reciente (${ageMin}min). Omitiendo refresh.`);
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: `Snapshot reciente (${ageMin}min < 4h mínimo)`,
          lastSnapshot: latestRow.recorded_at,
        });
      }
    }
  } catch (e) {
    // Si falla la verificación, continuar con el refresh por seguridad
    console.warn('[Cron/refresh-odds] No se pudo verificar snapshot reciente, continuando...', e);
  }

  try {
    const startTime = Date.now();
    console.log('[Cron/refresh-odds] 🔄 Iniciando refresh de odds...');

    const events = await getUpcomingMatches('upcoming');
    const elapsed = Date.now() - startTime;

    console.log(`[Cron/refresh-odds] ✅ ${events.length} eventos obtenidos en ${elapsed}ms`);

    await saveOddsSnapshot(events);

    return NextResponse.json({
      ok:              true,
      eventsRefreshed: events.length,
      elapsedMs:       elapsed,
      timestamp:       new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron/refresh-odds] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

