import { NextResponse } from 'next/server';
import { syncAllPendingBets } from '@/app/actions/syncScores';

export const maxDuration = 60;

function isAuthorizedCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('secret') === cronSecret) return true;

  return false;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
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
