import { NextResponse } from 'next/server';
import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { saveOddsSnapshot } from '@/app/actions/snapshots';

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

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  try {
    const events = await getUpcomingMatches('upcoming');
    await saveOddsSnapshot(events, force);
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
