import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { detectArbitrage } from '@/lib/algorithms/arbitrage-scanner';
import ArbitrageClient from './ArbitrageClient';

export default async function ArbitragePage() {
  const events = await getUpcomingMatches('upcoming');
  const arbs = detectArbitrage(events, 0.5);

  return <ArbitrageClient arbs={arbs} />;
}
