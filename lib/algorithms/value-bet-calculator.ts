/**
 * BetIQ Value Bet Calculator v3
 * 
 * Motor profesional de análisis multi-bookmaker.
 * - Consolida resultados: UNA recomendación por partido/pick (no repetidas por casa)
 * - Muestra rango de cuotas (min–max) en vez de una por bookmaker
 * - Soporta: H2H (1X2 + Empate), Totals (Over/Under)
 * - Cuotas filtradas: 1.50–5.00, prioridad 1.50–2.00
 */

import type { OddEvent } from '@/lib/apis/odds-api';

// ========== FÓRMULAS ==========

export function calculateValuePercentage(winProbability: number, decimalOdds: number): number {
  if (winProbability <= 0 || decimalOdds <= 1) return 0;
  return ((winProbability * decimalOdds) - 1) * 100;
}

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

// ========== TYPES ==========

export interface ValueBetOpportunity {
  eventId: string;
  event: string;
  pick: string;
  market: string;           // 'H2H', 'Empate', 'Over 2.5', 'Under 2.5', etc.
  oddsMin: number;          // Cuota más baja del mercado
  oddsMax: number;          // Cuota más alta (la mejor para el apostador)
  oddsBest: number;         // La mejor cuota encontrada
  bestBookmaker: string;    // El bookmaker que ofrece la mejor cuota
  bookmakerCount: number;   // Cuántas casas ofrecen este pick
  marketProbability: number;
  valuePercentage: number;
  kellyStake: number;
  sport: string;
  league: string;
  commenceTime: string;
}

// ========== DEPORTES PRINCIPALES ==========

const MAIN_SPORTS = [
  'soccer', 'basketball', 'baseball',
];

export function isMainSport(sportKey: string): boolean {
  return MAIN_SPORTS.some(s => sportKey.includes(s));
}

// ========== MOTOR PRINCIPAL ==========

export function extractValueBets(
  events: OddEvent[],
  minValueThreshold: number = 2.0,
  filterMainSports: boolean = true
): ValueBetOpportunity[] {
  const MIN_ODDS = 1.50;
  const MAX_ODDS = 5.00;

  // Mapa: eventId + pick → datos consolidados
  const consolidatedMap = new Map<string, {
    eventId: string;
    event: string;
    pick: string;
    market: string;
    odds: number[];
    bookmakers: string[];
    marketProb: number;
    sport: string;
    league: string;
    commenceTime: string;
  }>();

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;
    if (filterMainSports && !isMainSport(event.sport_key)) continue;

    const eventLabel = `${event.home_team} vs ${event.away_team}`;

    // ── H2H / 1X2 ──
    const teamOddsMap: Record<string, number[]> = {};
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (!teamOddsMap[o.name]) teamOddsMap[o.name] = [];
        teamOddsMap[o.name].push(o.price);
      }
    }

    const marketProbH2H: Record<string, number> = {};
    for (const [team, odds] of Object.entries(teamOddsMap)) {
      if (odds.length < 1) continue;
      marketProbH2H[team] = odds.reduce((s, o) => s + (1 / o), 0) / odds.length;
    }

    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (o.price < MIN_ODDS || o.price > MAX_ODDS) continue;
        const prob = marketProbH2H[o.name];
        if (!prob) continue;
        const value = calculateValuePercentage(prob, o.price);
        if (value < minValueThreshold) continue;

        const isDrawPick = o.name === 'Draw' || o.name === 'Empate';
        const pick = isDrawPick ? 'Empate' : `Gana ${o.name}`;
        const market = isDrawPick ? 'Empate' : 'H2H';
        const key = `${event.id}::${pick}`;

        if (!consolidatedMap.has(key)) {
          consolidatedMap.set(key, {
            eventId: event.id, event: eventLabel, pick, market,
            odds: [], bookmakers: [], marketProb: prob,
            sport: event.sport_key, league: event.sport_title,
            commenceTime: event.commence_time,
          });
        }
        const entry = consolidatedMap.get(key)!;
        entry.odds.push(o.price);
        if (!entry.bookmakers.includes(bk.title)) {
          entry.bookmakers.push(bk.title);
        }
      }
    }

    // ── Totals (Over/Under) ──
    const totalsMap: Record<string, { odds: number[]; bookmakers: string[] }> = {};
    for (const bk of event.bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (!totals?.outcomes) continue;
      for (const o of totals.outcomes) {
        const point = (o as any).point ?? '';
        const key = `${o.name} ${point}`.trim();
        if (!totalsMap[key]) totalsMap[key] = { odds: [], bookmakers: [] };
        totalsMap[key].odds.push(o.price);
        if (!totalsMap[key].bookmakers.includes(bk.title)) {
          totalsMap[key].bookmakers.push(bk.title);
        }
      }
    }

    const totalsProbMap: Record<string, number> = {};
    for (const [key, data] of Object.entries(totalsMap)) {
      if (data.odds.length < 2) continue;
      totalsProbMap[key] = data.odds.reduce((s, o) => s + (1 / o), 0) / data.odds.length;
    }

    for (const [pickLabel, data] of Object.entries(totalsMap)) {
      const prob = totalsProbMap[pickLabel];
      if (!prob) continue;

      // Filtrar: solo cuotas válidas entre MIN y MAX
      const validOdds = data.odds.filter(o => o >= MIN_ODDS && o <= MAX_ODDS);
      if (validOdds.length === 0) continue;

      const bestOdds = Math.max(...validOdds);
      const value = calculateValuePercentage(prob, bestOdds);
      if (value < minValueThreshold) continue;

      const key = `${event.id}::${pickLabel}`;
      if (!consolidatedMap.has(key)) {
        consolidatedMap.set(key, {
          eventId: event.id, event: eventLabel, pick: pickLabel,
          market: pickLabel.startsWith('Over') ? 'Over/Under' : 'Over/Under',
          odds: validOdds, bookmakers: data.bookmakers,
          marketProb: prob, sport: event.sport_key,
          league: event.sport_title, commenceTime: event.commence_time,
        });
      }
    }
  }

  // Convertir mapa a array de resultados consolidados
  const opportunities: ValueBetOpportunity[] = [];
  for (const entry of consolidatedMap.values()) {
    if (entry.odds.length === 0) continue;
    const oddsMin = Math.min(...entry.odds);
    const oddsMax = Math.max(...entry.odds);
    const oddsBest = oddsMax; // La mejor para el apostador es la más alta

    // El bookmaker que ofrece la mejor cuota
    // Recorremos para encontrarlo
    let bestBookmaker = entry.bookmakers[0] || 'N/A';

    const value = calculateValuePercentage(entry.marketProb, oddsBest);
    const kelly = calculateKellyCriterion(entry.marketProb, oddsBest, 0.25);

    opportunities.push({
      eventId: entry.eventId,
      event: entry.event,
      pick: entry.pick,
      market: entry.market,
      oddsMin, oddsMax, oddsBest,
      bestBookmaker,
      bookmakerCount: entry.bookmakers.length,
      marketProbability: entry.marketProb,
      valuePercentage: value,
      kellyStake: kelly,
      sport: entry.sport,
      league: entry.league,
      commenceTime: entry.commenceTime,
    });
  }

  // Deduplicar: solo la MEJOR selección por partido
  const bestPerEvent = new Map<string, ValueBetOpportunity>();
  for (const op of opportunities) {
    const existing = bestPerEvent.get(op.eventId);
    if (!existing || op.valuePercentage > existing.valuePercentage) {
      bestPerEvent.set(op.eventId, op);
    }
  }

  // Ordenar: prioridad cuotas 1.50–2.00, luego por valor descendente
  return Array.from(bestPerEvent.values()).sort((a, b) => {
    const aPriority = a.oddsBest <= 2.00 ? 1 : 0;
    const bPriority = b.oddsBest <= 2.00 ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.valuePercentage - a.valuePercentage;
  });
}

/**
 * Versión expandida: muestra TODAS las oportunidades por partido (para la página de Value Bets).
 * Aún consolidada por pick (no repetida por bookmaker), pero permite varios picks por partido.
 */
export function extractAllValueBets(
  events: OddEvent[],
  minValueThreshold: number = 2.0,
  filterMainSports: boolean = true
): ValueBetOpportunity[] {
  // Reusar la lógica anterior pero sin el paso de "best per event"
  const MIN_ODDS = 1.50;
  const MAX_ODDS = 5.00;
  const consolidatedMap = new Map<string, {
    eventId: string; event: string; pick: string; market: string;
    odds: number[]; bookmakers: string[]; marketProb: number;
    sport: string; league: string; commenceTime: string;
  }>();

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;
    if (filterMainSports && !isMainSport(event.sport_key)) continue;
    const eventLabel = `${event.home_team} vs ${event.away_team}`;

    // H2H
    const teamOddsMap: Record<string, number[]> = {};
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (!teamOddsMap[o.name]) teamOddsMap[o.name] = [];
        teamOddsMap[o.name].push(o.price);
      }
    }
    const marketProbH2H: Record<string, number> = {};
    for (const [team, odds] of Object.entries(teamOddsMap)) {
      if (odds.length < 1) continue;
      marketProbH2H[team] = odds.reduce((s, o) => s + (1 / o), 0) / odds.length;
    }
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (o.price < MIN_ODDS || o.price > MAX_ODDS) continue;
        const prob = marketProbH2H[o.name];
        if (!prob) continue;
        const value = calculateValuePercentage(prob, o.price);
        if (value < minValueThreshold) continue;
        const isDrawPick = o.name === 'Draw' || o.name === 'Empate';
        const pick = isDrawPick ? 'Empate' : `Gana ${o.name}`;
        const market = isDrawPick ? 'Empate' : 'H2H';
        const key = `${event.id}::${pick}`;
        if (!consolidatedMap.has(key)) {
          consolidatedMap.set(key, { eventId: event.id, event: eventLabel, pick, market, odds: [], bookmakers: [], marketProb: prob, sport: event.sport_key, league: event.sport_title, commenceTime: event.commence_time });
        }
        const entry = consolidatedMap.get(key)!;
        entry.odds.push(o.price);
        if (!entry.bookmakers.includes(bk.title)) entry.bookmakers.push(bk.title);
      }
    }

    // Totals
    const totalsMap: Record<string, { odds: number[]; bookmakers: string[] }> = {};
    for (const bk of event.bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (!totals?.outcomes) continue;
      for (const o of totals.outcomes) {
        const key = `${o.name} ${(o as any).point ?? ''}`.trim();
        if (!totalsMap[key]) totalsMap[key] = { odds: [], bookmakers: [] };
        totalsMap[key].odds.push(o.price);
        if (!totalsMap[key].bookmakers.includes(bk.title)) totalsMap[key].bookmakers.push(bk.title);
      }
    }
    const totalsProbMap: Record<string, number> = {};
    for (const [key, data] of Object.entries(totalsMap)) {
      if (data.odds.length < 2) continue;
      totalsProbMap[key] = data.odds.reduce((s, o) => s + (1 / o), 0) / data.odds.length;
    }
    for (const [pickLabel, data] of Object.entries(totalsMap)) {
      const prob = totalsProbMap[pickLabel];
      if (!prob) continue;
      const validOdds = data.odds.filter(o => o >= MIN_ODDS && o <= MAX_ODDS);
      if (validOdds.length === 0) continue;
      const bestOdds = Math.max(...validOdds);
      const value = calculateValuePercentage(prob, bestOdds);
      if (value < minValueThreshold) continue;
      const key = `${event.id}::${pickLabel}`;
      if (!consolidatedMap.has(key)) {
        consolidatedMap.set(key, { eventId: event.id, event: eventLabel, pick: pickLabel, market: 'Over/Under', odds: validOdds, bookmakers: data.bookmakers, marketProb: prob, sport: event.sport_key, league: event.sport_title, commenceTime: event.commence_time });
      }
    }
  }

  const opportunities: ValueBetOpportunity[] = [];
  for (const entry of consolidatedMap.values()) {
    if (entry.odds.length === 0) continue;
    const oddsMin = Math.min(...entry.odds);
    const oddsMax = Math.max(...entry.odds);
    const value = calculateValuePercentage(entry.marketProb, oddsMax);
    const kelly = calculateKellyCriterion(entry.marketProb, oddsMax, 0.25);
    opportunities.push({
      eventId: entry.eventId, event: entry.event, pick: entry.pick,
      market: entry.market, oddsMin, oddsMax, oddsBest: oddsMax,
      bestBookmaker: entry.bookmakers[0] || 'N/A',
      bookmakerCount: entry.bookmakers.length,
      marketProbability: entry.marketProb, valuePercentage: value,
      kellyStake: kelly, sport: entry.sport, league: entry.league,
      commenceTime: entry.commenceTime,
    });
  }

  return opportunities.sort((a, b) => {
    const aPriority = a.oddsBest <= 2.00 ? 1 : 0;
    const bPriority = b.oddsBest <= 2.00 ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.valuePercentage - a.valuePercentage;
  });
}

// ========== ANÁLISIS DE MEJOR PICK POR PARTIDO ==========

export interface SmartPick {
  eventId: string;
  event: string;
  sport: string;
  league: string;
  commenceTime: string;
  bestPick: string;       // "Gana Arsenal", "Over 2.5", "Empate"
  bestMarket: string;     // "H2H", "Over/Under", "Empate"
  oddsRange: string;      // "1.85–2.10"
  bestOdds: number;
  valuePercentage: number;
  kellyStake: number;
  marketProbability: number;
  confidence: 'alta' | 'media' | 'baja';
  bookmakerCount: number;
}

/**
 * Analiza todos los mercados de un partido y devuelve EL MEJOR pick.
 * Esto es lo que el usuario ve en el Dashboard — la recomendación del analista.
 */
export function getSmartPicks(
  events: OddEvent[],
  filterMainSports: boolean = true
): SmartPick[] {
  const MIN_ODDS = 1.50;
  const MAX_ODDS = 5.00;
  const picks: SmartPick[] = [];

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;
    if (filterMainSports && !isMainSport(event.sport_key)) continue;

    const eventLabel = `${event.home_team} vs ${event.away_team}`;
    let bestValue = 0;
    let bestPick: SmartPick | null = null;

    // Analizar H2H
    const teamOddsMap: Record<string, number[]> = {};
    for (const bk of event.bookmakers) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h?.outcomes) continue;
      for (const o of h2h.outcomes) {
        if (!teamOddsMap[o.name]) teamOddsMap[o.name] = [];
        teamOddsMap[o.name].push(o.price);
      }
    }
    const marketProbH2H: Record<string, number> = {};
    for (const [team, odds] of Object.entries(teamOddsMap)) {
      if (odds.length < 1) continue;
      marketProbH2H[team] = odds.reduce((s, o) => s + (1 / o), 0) / odds.length;
    }

    for (const [team, odds] of Object.entries(teamOddsMap)) {
      const validOdds = odds.filter(o => o >= MIN_ODDS && o <= MAX_ODDS);
      if (validOdds.length === 0) continue;
      const prob = marketProbH2H[team];
      if (!prob) continue;
      const bestO = Math.max(...validOdds);
      const value = calculateValuePercentage(prob, bestO);
      const isDrawPick = team === 'Draw' || team === 'Empate';
      const pick = isDrawPick ? 'Empate' : `Gana ${team}`;
      const market = isDrawPick ? 'Empate' : 'H2H';

      // Seleccionar si tiene valor O si es simplemente la mejor opción
      const score = value > 0 ? value : -(1 / bestO) * 100; // Si no hay value, usa prob implícita como fallback
      
      if (score > bestValue || !bestPick) {
        bestValue = score;
        bestPick = {
          eventId: event.id,
          event: eventLabel,
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
          bestPick: pick,
          bestMarket: market,
          oddsRange: validOdds.length > 1
            ? `${Math.min(...validOdds).toFixed(2)}–${Math.max(...validOdds).toFixed(2)}`
            : bestO.toFixed(2),
          bestOdds: bestO,
          valuePercentage: Math.max(0, value),
          kellyStake: calculateKellyCriterion(prob, bestO, 0.25),
          marketProbability: prob,
          confidence: value >= 5 ? 'alta' : value >= 2 ? 'media' : 'baja',
          bookmakerCount: validOdds.length,
        };
      }
    }

    // Analizar Totals
    for (const bk of event.bookmakers) {
      const totals = bk.markets?.find(m => m.key === 'totals');
      if (!totals?.outcomes) continue;
      for (const o of totals.outcomes) {
        if (o.price < MIN_ODDS || o.price > MAX_ODDS) continue;
        const point = (o as any).point ?? '';
        const pickLabel = `${o.name} ${point}`.trim();

        // Necesitamos la prob del mercado para este total
        const allOddsForThis: number[] = [];
        for (const bk2 of event.bookmakers) {
          const t2 = bk2.markets?.find(m => m.key === 'totals');
          if (!t2?.outcomes) continue;
          const match = t2.outcomes.find(x => `${x.name} ${(x as any).point ?? ''}`.trim() === pickLabel);
          if (match) allOddsForThis.push(match.price);
        }
        if (allOddsForThis.length < 2) continue;
        const prob = allOddsForThis.reduce((s, x) => s + (1 / x), 0) / allOddsForThis.length;
        const bestO = Math.max(...allOddsForThis.filter(x => x >= MIN_ODDS && x <= MAX_ODDS));
        const value = calculateValuePercentage(prob, bestO);
        const score = value > 0 ? value : -(1 / bestO) * 100;

        if (score > bestValue || !bestPick) {
          bestValue = score;
          const validOdds = allOddsForThis.filter(x => x >= MIN_ODDS && x <= MAX_ODDS);
          bestPick = {
            eventId: event.id,
            event: eventLabel,
            sport: event.sport_key,
            league: event.sport_title,
            commenceTime: event.commence_time,
            bestPick: pickLabel,
            bestMarket: 'Over/Under',
            oddsRange: validOdds.length > 1
              ? `${Math.min(...validOdds).toFixed(2)}–${Math.max(...validOdds).toFixed(2)}`
              : bestO.toFixed(2),
            bestOdds: bestO,
            valuePercentage: Math.max(0, value),
            kellyStake: calculateKellyCriterion(prob, bestO, 0.25),
            marketProbability: prob,
            confidence: value >= 5 ? 'alta' : value >= 2 ? 'media' : 'baja',
            bookmakerCount: validOdds.length,
          };
        }
      }
    }

    if (bestPick) picks.push(bestPick);
  }

  // Ordenar: primero los que tienen valor real, luego por valor descendente
  return picks.sort((a, b) => {
    if (a.valuePercentage > 0 && b.valuePercentage <= 0) return -1;
    if (b.valuePercentage > 0 && a.valuePercentage <= 0) return 1;
    return b.valuePercentage - a.valuePercentage;
  });
}

// ========== STATS ==========

export function calculateBettingStats(bets: Array<{
  status: string; stake: number; odds: number; profit: number;
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
  return { total, won: won.length, lost: lost.length, pending: pending.length, totalStaked, totalProfit, roi, winRate };
}
