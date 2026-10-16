import { OddEvent } from '@/lib/apis/odds-api';

/**
 * BetIQ Arbitrage Scanner v4.0 (con Anti-Gubbing Stake Rounding)
 *
 * Detecta oportunidades de arbitraje real entre bookmakers (H2H y Totals)
 * e implementa redondeo de stakes (múltiplos de $1, $5 o $10) para evitar
 * detección/limitación de cuentas ("gubbing") por apostar centavos exactos.
 */

export type StakeRoundingStep = 1 | 5 | 10;

export interface ArbLeg {
  outcome: string;           // 'Gana Arsenal' | 'Over 2.5'
  bookmaker: string;
  odds: number;
  stakeRatio: number;        // Stake exacto para un bankroll base de $100
  roundedStake1: number;     // Redondeado a múltiplo de $1
  roundedStake5: number;     // Redondeado a múltiplo de $5
  roundedStake10: number;    // Redondeado a múltiplo de $10
}

export interface RoundedArbMetrics {
  step: StakeRoundingStep;
  legsStakes: number[];
  totalStake: number;
  minReturn: number;
  netProfit: number;
  roiPct: number;
  isProfitableAfterRounding: boolean;
}

export interface ArbOpportunity {
  eventId: string;
  event: string;
  sport: string;
  league: string;
  commenceTime: string;
  market: string;            // 'H2H' | 'Over/Under 2.5'
  profitPct: number;         // % de ganancia matemática exacta
  legs: ArbLeg[];
  totalStake: number;        // Base $100
  roundingByStep: Record<StakeRoundingStep, RoundedArbMetrics>;
}

/**
 * Calcula los stakes redondeados al múltiplo `step` ($1, $5 o $10) sobre un capital base
 * y recalcula el ROI neto garantizado en el peor escenario después del redondeo.
 */
export function calculateAntiGubbingRounding(
  legs: Array<{ odds: number; stakeRatio: number }>,
  step: StakeRoundingStep,
  baseBudget: number = 100
): RoundedArbMetrics {
  const scaledStakes = legs.map(l => (l.stakeRatio / 100) * baseBudget);
  const roundedStakes = scaledStakes.map(s => Math.max(step, Math.round(s / step) * step));

  const totalStake = roundedStakes.reduce((sum, s) => sum + s, 0);
  const payouts = roundedStakes.map((s, idx) => s * legs[idx].odds);
  const minReturn = payouts.length > 0 ? Math.min(...payouts) : 0;
  const netProfit = Number((minReturn - totalStake).toFixed(2));
  const roiPct = totalStake > 0 ? Number(((netProfit / totalStake) * 100).toFixed(2)) : 0;

  return {
    step,
    legsStakes: roundedStakes,
    totalStake,
    minReturn: Number(minReturn.toFixed(2)),
    netProfit,
    roiPct,
    isStillProfitable: netProfit > 0,
    isProfitableAfterRounding: netProfit > 0,
  } as RoundedArbMetrics;
}

function buildArbOpportunity(
  event: OddEvent,
  marketLabel: string,
  outcomes: Array<[string, { odds: number; bookmaker: string }]>,
  minProfitPct: number
): ArbOpportunity | null {
  if (outcomes.length < 2) return null;

  const impliedSum = outcomes.reduce((s, [, v]) => s + (1 / v.odds), 0);
  if (impliedSum >= 1.0 || impliedSum <= 0) return null;

  const profitPct = ((1 - impliedSum) / impliedSum) * 100;
  if (profitPct < minProfitPct) return null;

  const baseLegs = outcomes.map(([name, v]) => {
    const exactStakeOn100 = ((1 / v.odds) / impliedSum) * 100;
    return {
      outcome: name,
      bookmaker: v.bookmaker,
      odds: v.odds,
      stakeRatio: exactStakeOn100,
    };
  });

  const r1  = calculateAntiGubbingRounding(baseLegs, 1, 100);
  const r5  = calculateAntiGubbingRounding(baseLegs, 5, 100);
  const r10 = calculateAntiGubbingRounding(baseLegs, 10, 100);

  const legs: ArbLeg[] = baseLegs.map((l, idx) => ({
    ...l,
    roundedStake1:  r1.legsStakes[idx],
    roundedStake5:  r5.legsStakes[idx],
    roundedStake10: r10.legsStakes[idx],
  }));

  return {
    eventId: event.id,
    event: `${event.home_team} vs ${event.away_team}`,
    sport: event.sport_key,
    league: event.sport_title,
    commenceTime: event.commence_time,
    market: marketLabel,
    profitPct,
    legs,
    totalStake: 100,
    roundingByStep: {
      1: r1,
      5: r5,
      10: r10,
    },
  };
}

export function detectArbitrage(
  events: OddEvent[],
  minProfitPct: number = 0.5
): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;

    // 1. H2H Arbitrage
    const bestH2H: Record<string, { odds: number; bookmaker: string }> = {};
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (!bestH2H[o.name] || o.price > bestH2H[o.name].odds) {
          bestH2H[o.name] = { odds: o.price, bookmaker: bk.title };
        }
      }
    }

    const h2hArb = buildArbOpportunity(event, 'H2H', Object.entries(bestH2H), minProfitPct);
    if (h2hArb) opportunities.push(h2hArb);

    // 2. Totals Arbitrage (por línea exacta, ej. Over 2.5 vs Under 2.5)
    const totalsByPoint = new Map<string, Record<string, { odds: number; bookmaker: string }>>();
    for (const bk of event.bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (!totals?.outcomes) continue;
      for (const o of totals.outcomes) {
        if (o.point === undefined || o.point === null) continue;
        const pointKey = String(o.point);
        if (!totalsByPoint.has(pointKey)) totalsByPoint.set(pointKey, {});
        const mapForPoint = totalsByPoint.get(pointKey)!;
        const label = `${o.name} ${pointKey}`;
        if (!mapForPoint[label] || o.price > mapForPoint[label].odds) {
          mapForPoint[label] = { odds: o.price, bookmaker: bk.title };
        }
      }
    }

    for (const [pointKey, outcomesObj] of totalsByPoint.entries()) {
      const entries = Object.entries(outcomesObj);
      if (entries.length === 2) {
        const totalsArb = buildArbOpportunity(event, `Totals (${pointKey})`, entries, minProfitPct);
        if (totalsArb) opportunities.push(totalsArb);
      }
    }
  }

  return opportunities.sort((a, b) => b.profitPct - a.profitPct);
}
