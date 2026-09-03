import { getUpcomingMatches, categorizeEventsByTime } from '@/lib/apis/odds-api';
import { extractAllValueBets } from '@/lib/algorithms/value-bet-calculator';
import ValueBetsClient from './ValueBetsClient';

export default async function ValueBetsPage() {
  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming, possiblyLive } = categorizeEventsByTime(allEvents);
  const allValid = [...upcoming, ...possiblyLive];
  
  // Extraemos todas las discrepancias matemáticas.
  // minValue = 1.0 para que el cliente pueda filtrar desde 1% en adelante.
  const valueBets = extractAllValueBets(allValid, 1.0, true);

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <ValueBetsClient initialBets={valueBets} />
    </div>
  );
}
