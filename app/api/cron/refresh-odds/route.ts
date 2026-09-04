import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { saveOddsSnapshot } from '@/app/actions/snapshots';

// Permitir hasta 60s de ejecución en Vercel para evitar cortes prematuros
export const maxDuration = 60;

// Vercel Cron / cron-job.org: ejecuta para mantener el snapshot de odds actualizado.
// El rate-limit interno de saveOddsSnapshot evita duplicados si se llama más seguido.
export async function GET(request: Request) {
  // Validar que venga de Vercel Cron (en producción)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const events = await getUpcomingMatches('upcoming');
    await saveOddsSnapshot(events);
    return NextResponse.json({
      ok: true,
      eventsRefreshed: events.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron/refresh-odds] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
