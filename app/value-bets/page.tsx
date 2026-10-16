import { getUpcomingMatches, categorizeEventsByTime } from '@/lib/apis/odds-api';
import { extractAllValueBets } from '@/lib/algorithms/value-bet-calculator';
import { detectSteamMoves } from '@/app/actions/snapshots';
import ValueBetsClient from './ValueBetsClient';

export default async function ValueBetsPage() {
  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming, possiblyLive } = categorizeEventsByTime(allEvents);
  const allValid = [...upcoming, ...possiblyLive];

  // Extraemos todas las discrepancias matemáticas con Power Devigging y Consenso Sharp
  const rawValueBets = extractAllValueBets(allValid, 1.0, true);
  const { steamMap } = await detectSteamMoves(allValid);

  const valueBets = rawValueBets.map(vb => {
    const cleanPick = vb.pick.replace(/🔥/g, '').trim();
    const steam = steamMap.get(`${vb.eventId}::${cleanPick}`);
    if (steam) {
      return {
        ...vb,
        isSteamMove: true,
        steamMoveDelta: steam.impliedProbDeltaPct,
      };
    }
    return vb;
  });

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <ValueBetsClient initialBets={valueBets} />
    </div>
  );
}
