import { OddEvent } from '@/lib/apis/odds-api';

/**
 * Detecta oportunidades de arbitraje real entre bookmakers.
 * Un arb existe cuando la suma de (1/bestOdds) de todos los
 * outcomes de un mercado es menor a 1.0.
 * Profit garantizado = (1 - sum) / sum * 100 %
 */

export interface ArbLeg {
  outcome: string;     // 'Gana Arsenal' | 'Over 2.5'
  bookmaker: string;
  odds: number;
  stakeRatio: number;  // % del total a apostar en este leg
}

export interface ArbOpportunity {
  eventId: string;
  event: string;
  sport: string;
  league: string;
  commenceTime: string;
  market: string;      // 'H2H' | 'Over/Under'
  profitPct: number;   // % de ganancia garantizada
  legs: ArbLeg[];      // Un leg por cada outcome
  totalStake: number;  // Stake total para ganar $100
}

export function detectArbitrage(
  events: OddEvent[],
  minProfitPct: number = 0.5  // Solo arbs de al menos 0.5%
): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;

    // ── H2H Arb ──
    // Para cada outcome, encontrar la mejor cuota entre todos los bookmakers
    const bestOddsPerOutcome: Record<string, { odds: number; bookmaker: string }> = {};
    
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (!bestOddsPerOutcome[o.name] || o.price > bestOddsPerOutcome[o.name].odds) {
          bestOddsPerOutcome[o.name] = { odds: o.price, bookmaker: bk.title };
        }
      }
    }

    const outcomes = Object.entries(bestOddsPerOutcome);
    if (outcomes.length < 2) continue;

    const impliedSum = outcomes.reduce((s, [, v]) => s + (1 / v.odds), 0);
    
    if (impliedSum < 1.0) {
      const profitPct = ((1 - impliedSum) / impliedSum) * 100;
      if (profitPct < minProfitPct) continue;

      const legs: ArbLeg[] = outcomes.map(([name, v]) => ({
        outcome: name,
        bookmaker: v.bookmaker,
        odds: v.odds,
        stakeRatio: (1 / v.odds) / impliedSum * 100,
      }));

      opportunities.push({
        eventId: event.id,
        event: `${event.home_team} vs ${event.away_team}`,
        sport: event.sport_key,
        league: event.sport_title,
        commenceTime: event.commence_time,
        market: 'H2H',
        profitPct,
        legs,
        totalStake: 100 / (1 - impliedSum),
      });
    }
  }

  return opportunities.sort((a, b) => b.profitPct - a.profitPct);
}
