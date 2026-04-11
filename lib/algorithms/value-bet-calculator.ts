/**
 * BetIQ Value Bet Calculator
 * 
 * Motor matemático para detectar oportunidades de apuestas con valor positivo.
 * Utiliza las cuotas de múltiples bookmakers para calcular probabilidades de mercado reales.
 */

import type { OddEvent } from '@/lib/apis/odds-api';

// ========== FÓRMULAS BÁSICAS ==========

/**
 * Calcula si una apuesta tiene Valor (Value Bet).
 * @param winProbability Probabilidad real estimada (0.00 a 1.00)
 * @param decimalOdds Cuota que ofrece la casa de apuestas (ej. 2.15)
 */
export function calculateValuePercentage(winProbability: number, decimalOdds: number): number {
  if (winProbability <= 0 || decimalOdds <= 1) return 0;
  const value = (winProbability * decimalOdds) - 1;
  return value * 100;
}

/**
 * Calcula la fracción de Kelly Criterion óptima.
 * @param fraction 0.25 = Quarter Kelly (conservador, recomendado)
 */
export function calculateKellyCriterion(
  winProbability: number,
  decimalOdds: number,
  fraction: number = 0.25
): number {
  const q = 1 - winProbability;
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const f_star = ((b * winProbability) - q) / b;
  if (f_star <= 0) return 0;
  return (f_star * fraction) * 100;
}

// ========== MOTOR MULTI-BOOKMAKER (REAL) ==========

export interface ValueBetOpportunity {
  eventId: string;
  event: string;
  pick: string;
  team: string;
  bookmaker: string;
  odds: number;
  marketProbability: number;   // Probabilidad implícita promedio del mercado
  impliedProbability: number;  // Probabilidad implícita de ESTE bookmaker
  valuePercentage: number;     // Value% real vs mercado
  kellyStake: number;          // % de bankroll sugerido (Quarter Kelly)
  sport: string;
  league: string;
  commenceTime: string;
}

/**
 * Motor principal de value betting.
 * - Cuotas filtradas entre 1.50 y 5.00 (rango profesional).
 * - Mercados soportados: H2H (1X2), Empate, Over/Under (totals).
 * - Prioriza el rango 1.50–2.00 según indicado.
 * 
 * @param events Respuesta completa de la Odds API
 * @param minValueThreshold Umbral mínimo de valor para considerar (default: 2%)
 */
export function extractValueBets(
  events: OddEvent[],
  minValueThreshold: number = 2.0
): ValueBetOpportunity[] {
  const MIN_ODDS = 1.50;
  const MAX_ODDS = 5.00;
  const opportunities: ValueBetOpportunity[] = [];

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;

    // ── H2H / 1X2 Market ──────────────────────────────────────────────────
    const teamOddsMap: Record<string, number[]> = {};

    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (!teamOddsMap[o.name]) teamOddsMap[o.name] = [];
        teamOddsMap[o.name].push(o.price);
      }
    }

    // Calcular probabilidad media del mercado para cada resultado
    const marketProbMap: Record<string, number> = {};
    for (const [team, odds] of Object.entries(teamOddsMap)) {
      if (odds.length < 1) continue;
      marketProbMap[team] = odds.reduce((s, o) => s + (1 / o), 0) / odds.length;
    }

    // Buscar value en H2H + Empate
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;

      for (const o of h2h.outcomes) {
        if (o.price < MIN_ODDS || o.price > MAX_ODDS) continue;

        const marketProb = marketProbMap[o.name];
        if (!marketProb) continue;

        const value = calculateValuePercentage(marketProb, o.price);
        if (value < minValueThreshold) continue;

        // Determinar si es empate o equipo ganador
        const pick = o.name === 'Draw' || o.name === 'Empate'
          ? 'Empate'
          : `Gana ${o.name}`;

        opportunities.push({
          eventId: event.id,
          event: `${event.home_team} vs ${event.away_team}`,
          pick,
          team: o.name,
          bookmaker: bk.title,
          odds: o.price,
          marketProbability: marketProb,
          impliedProbability: 1 / o.price,
          valuePercentage: value,
          kellyStake: calculateKellyCriterion(marketProb, o.price, 0.25),
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
        });
      }
    }

    // ── Totals (Over/Under) Market ─────────────────────────────────────────
    const totalsMap: Record<string, number[]> = {};

    for (const bk of event.bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (!totals?.outcomes) continue;
      for (const o of totals.outcomes) {
        const key = `${o.name} ${(o as any).point ?? ''}`.trim();
        if (!totalsMap[key]) totalsMap[key] = [];
        totalsMap[key].push(o.price);
      }
    }

    const totalsProbMap: Record<string, number> = {};
    for (const [key, odds] of Object.entries(totalsMap)) {
      if (odds.length < 2) continue; // necesitamos al menos 2 bookmakers
      totalsProbMap[key] = odds.reduce((s, o) => s + (1 / o), 0) / odds.length;
    }

    for (const bk of event.bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (!totals?.outcomes) continue;
      for (const o of totals.outcomes) {
        if (o.price < MIN_ODDS || o.price > MAX_ODDS) continue;
        const key = `${o.name} ${(o as any).point ?? ''}`.trim();
        const marketProb = totalsProbMap[key];
        if (!marketProb) continue;

        const value = calculateValuePercentage(marketProb, o.price);
        if (value < minValueThreshold) continue;

        opportunities.push({
          eventId: event.id,
          event: `${event.home_team} vs ${event.away_team}`,
          pick: `${o.name} ${(o as any).point ?? ''}`.trim(),
          team: o.name,
          bookmaker: bk.title,
          odds: o.price,
          marketProbability: marketProb,
          impliedProbability: 1 / o.price,
          valuePercentage: value,
          kellyStake: calculateKellyCriterion(marketProb, o.price, 0.25),
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
        });
      }
    }
  }

  // Ordenar: primero los del rango 1.50–2.00 (prioridad), luego por valor descendente
  return opportunities.sort((a, b) => {
    const aPriority = a.odds <= 2.00 ? 1 : 0;
    const bPriority = b.odds <= 2.00 ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.valuePercentage - a.valuePercentage;
  });
}


/**
 * Calcula estadísticas de rendimiento desde el historial de apuestas.
 */
export function calculateBettingStats(bets: Array<{
  status: string;
  stake: number;
  odds: number;
  profit: number;
}>) {
  const total = bets.length;
  const closed = bets.filter(b => b.status === 'won' || b.status === 'lost');
  const won = bets.filter(b => b.status === 'won');
  const lost = bets.filter(b => b.status === 'lost');
  const pending = bets.filter(b => b.status === 'pending');

  const totalStaked = closed.reduce((sum, b) => sum + b.stake, 0);
  const totalProfit = bets.reduce((sum, b) => sum + (b.profit || 0), 0);
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
  const winRate = closed.length > 0 ? (won.length / closed.length) * 100 : 0;

  return {
    total,
    won: won.length,
    lost: lost.length,
    pending: pending.length,
    totalStaked,
    totalProfit,
    roi,
    winRate,
  };
}
