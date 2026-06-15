import { NextResponse } from 'next/server';
import { syncAllPendingBets } from '@/app/actions/syncScores';

// Vercel Cron: ejecuta cada 3 horas para auto-gradear apuestas pendientes.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncAllPendingBets();
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron/sync-scores] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
