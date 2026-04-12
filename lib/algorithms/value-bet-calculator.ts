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

// ========== CONFIGURACIÓN DE SHARP BOOKS ==========

// Pesos de bookmakers: sharp books valen más en el consenso de probabilidad.
// Los que no están en esta lista reciben peso 1.0 (baseline).
const BOOKMAKER_WEIGHTS: Record<string, number> = {
  'pinnacle':         3.0,  // El sharp book por excelencia
  'betfair_ex_eu':    2.5,  // Exchange — cuotas sin margen
  'betfair_ex_uk':    2.5,
  'bookmaker':        2.0,  // Conocido por aceptar ganadores
  'betsson':          1.5,
  'unibet_eu':        1.5,
  'williamhill':      1.3,
  'bet365':           1.2,
  'draftkings':       0.8,  // Square book, mercado US menos eficiente
  'fanduel':          0.8,
  'bovada':           0.7,
};

function getBookmakerWeight(bookmakerKey: string): number {
  return BOOKMAKER_WEIGHTS[bookmakerKey] ?? 1.0;
}

// ========== FÓRMULAS ==========

/**
 * Elimina el overround (margen del bookmaker) de un conjunto de cuotas decimales.
 * Método multiplicativo: normaliza para que las probs implícitas sumen exactamente 1.
 * 
 * @param odds - Array de cuotas decimales de TODOS los outcomes del mismo mercado
 * @returns Array de probabilidades "justas" (sin margen) en el mismo orden
 */
export function removeVig(odds: number[]): number[] {
  const impliedProbs = odds.map(o => 1 / o);
  const overround = impliedProbs.reduce((s, p) => s + p, 0);
  return impliedProbs.map(p => p / overround);
}

export function calculateValuePercentage(winProbability: number, decimalOdds: number): number {
  if (winProbability <= 0 || decimalOdds <= 1) return 0;
  return ((winProbability * decimalOdds) - 1) * 100;
}

// Kelly criterion actualizado para no apostar sin edge
export function calculateKellyCriterion(
  winProbability: number,
  decimalOdds: number,
  fraction: number = 0.25
): number {
  const valuePct = calculateValuePercentage(winProbability, decimalOdds);
  if (valuePct <= 0) return 0;
  
  const q = 1 - winProbability;
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const f_star = ((b * winProbability) - q) / b;
  if (f_star <= 0) return 0;  // Sin edge positivo → Kelly = 0
  return Math.min((f_star * fraction) * 100, 5); // Cap en 5% del bankroll por seguridad
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
  consensusStrength: number; // 0-1, qué % de bookmakers coincide en la dirección del pick
  sport: string;
  league: string;
  commenceTime: string;
}

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
  consensusStrength: number; // 0-1, qué % de bookmakers coincide en la dirección del pick
}

// ========== DEPORTES PRINCIPALES ==========

const MAIN_SPORTS = [
  'soccer', 'basketball', 'baseball',
];

export function isMainSport(sportKey: string): boolean {
  return MAIN_SPORTS.some(s => sportKey.includes(s));
}

// ========== HELPERS DE MERCADOS ==========

interface ParsedMarketPick {
  fairProb: number;
  bestOdds: number;
  bookmakerCount: number; // Count of valid odds for this pick
  consensusStrength: number;
  oddsArray: number[];
  validOdds: number[];
  bestBookmaker: string;
}

const MIN_ODDS = 1.50;
const MAX_ODDS = 5.00;

function parseH2HMarket(event: OddEvent): Map<string, ParsedMarketPick> {
  const bkFairProbs = new Map<string, Record<string, number>>();
  for (const bk of event.bookmakers) {
    const h2h = bk.markets?.find(m => m.key === 'h2h');
    if (!h2h?.outcomes || h2h.outcomes.length === 0) continue;
    const prices = h2h.outcomes.map(o => o.price);
    const names = h2h.outcomes.map(o => o.name);
    const fairProbs = removeVig(prices);
    const probMap: Record<string, number> = {};
    for (let i = 0; i < names.length; i++) {
        probMap[names[i]] = fairProbs[i];
    }
    bkFairProbs.set(bk.key, probMap);
  }

  const outcomeData = new Map<string, { 
    odds: {price: number, bkKey: string, bkTitle: string}[],
  }>();

  for (const bk of event.bookmakers) {
    const h2h = bk.markets?.find(m => m.key === 'h2h');
    if (!h2h?.outcomes) continue;
    for (const o of h2h.outcomes) {
       if (!outcomeData.has(o.name)) outcomeData.set(o.name, { odds: [] });
       outcomeData.get(o.name)!.odds.push({ price: o.price, bkKey: bk.key, bkTitle: bk.title });
    }
  }

  const result = new Map<string, ParsedMarketPick>();
  
  for (const [outcome, data] of outcomeData.entries()) {
    let totalWeight = 0;
    let weightedProbSum = 0;
    for (const odd of data.odds) {
      const probMap = bkFairProbs.get(odd.bkKey);
      if (probMap && probMap[outcome] !== undefined) {
        const w = getBookmakerWeight(odd.bkKey);
        weightedProbSum += probMap[outcome] * w; // weighted the FAIR probabilities
        totalWeight += w;
      }
    }
    const fairProb = totalWeight > 0 ? weightedProbSum / totalWeight : 0;
    
    const validOddsItems = data.odds.filter(o => o.price >= MIN_ODDS && o.price <= MAX_ODDS);
    const oddsArray = data.odds.map(o => o.price);
    const validOdds = validOddsItems.map(o => o.price);
    
    let booksSupportingPick = 0;
    for (const odd of data.odds) {
        if (odd.price < 2.5) booksSupportingPick++;
    }
    const consensusStrength = event.bookmakers.length > 0 ? booksSupportingPick / event.bookmakers.length : 0;
    
    let bestOdds = 0;
    let bestBookmaker = 'N/A';
    if (validOddsItems.length > 0) {
      let bestOddsItem = validOddsItems[0];
      for (const item of validOddsItems) {
        if (item.price > bestOddsItem.price) {
          bestOddsItem = item;
        }
      }
      bestOdds = bestOddsItem.price;
      bestBookmaker = bestOddsItem.bkTitle;
    } else if (data.odds.length > 0) {
       bestOdds = Math.max(...oddsArray);
       const match = data.odds.find(o => o.price === bestOdds);
       if (match) bestBookmaker = match.bkTitle;
    }
    
    result.set(outcome, {
      fairProb,
      bestOdds,
      bookmakerCount: validOddsItems.length,
      consensusStrength,
      oddsArray,
      validOdds,
      bestBookmaker
    });
  }
  
  return result;
}

function parseTotalsMarket(event: OddEvent): Map<string, ParsedMarketPick> {
  const bkFairProbs = new Map<string, Record<string, number>>();
  for (const bk of event.bookmakers) {
    const totals = bk.markets?.find(m => m.key === 'totals');
    if (!totals?.outcomes || totals.outcomes.length === 0) continue;
    
    const pointsMap = new Map<string, {name: string, price: number}[]>();
    for (const o of totals.outcomes) {
       const point = (o as any).point ? String((o as any).point) : 'default';
       if (!pointsMap.has(point)) pointsMap.set(point, []);
       pointsMap.get(point)!.push({ name: o.name, price: o.price });
    }
    
    const probMap: Record<string, number> = {};
    for (const [point, group] of pointsMap.entries()) {
      if (group.length < 2) continue; // Normally a total outcome requires over/under pair
      const prices = group.map(x => x.price);
      const fairProbs = removeVig(prices);
      for (let i = 0; i < group.length; i++) {
         probMap[`${group[i].name} ${point === 'default' ? '' : point}`.trim()] = fairProbs[i];
      }
    }
    bkFairProbs.set(bk.key, probMap);
  }

  const outcomeData = new Map<string, { 
    odds: {price: number, bkKey: string, bkTitle: string}[],
  }>();

  for (const bk of event.bookmakers) {
    const totals = bk.markets?.find(m => m.key === 'totals');
    if (!totals?.outcomes) continue;
    for (const o of totals.outcomes) {
       const point = (o as any).point ? String((o as any).point) : 'default';
       const pickLabel = `${o.name} ${point === 'default' ? '' : point}`.trim();
       if (!outcomeData.has(pickLabel)) outcomeData.set(pickLabel, { odds: [] });
       outcomeData.get(pickLabel)!.odds.push({ price: o.price, bkKey: bk.key, bkTitle: bk.title });
    }
  }

  const result = new Map<string, ParsedMarketPick>();
  
  for (const [outcome, data] of outcomeData.entries()) {
    let totalWeight = 0;
    let weightedProbSum = 0;
    for (const odd of data.odds) {
      const probMap = bkFairProbs.get(odd.bkKey);
      if (probMap && probMap[outcome] !== undefined) {
        const w = getBookmakerWeight(odd.bkKey);
        weightedProbSum += probMap[outcome] * w;
        totalWeight += w;
      }
    }
    const fairProb = totalWeight > 0 ? weightedProbSum / totalWeight : 0;
    
    const validOddsItems = data.odds.filter(o => o.price >= MIN_ODDS && o.price <= MAX_ODDS);
    const oddsArray = data.odds.map(o => o.price);
    const validOdds = validOddsItems.map(o => o.price);
    
    let booksSupportingPick = 0;
    for (const odd of data.odds) {
        if (odd.price < 2.5) booksSupportingPick++;
    }
    const consensusStrength = event.bookmakers.length > 0 ? booksSupportingPick / event.bookmakers.length : 0;
    
    let bestOdds = 0;
    let bestBookmaker = 'N/A';
    if (validOddsItems.length > 0) {
      let bestOddsItem = validOddsItems[0];
      for (const item of validOddsItems) {
        if (item.price > bestOddsItem.price) {
          bestOddsItem = item;
        }
      }
      bestOdds = bestOddsItem.price;
      bestBookmaker = bestOddsItem.bkTitle;
    } else if (data.odds.length > 0) {
       bestOdds = Math.max(...oddsArray);
       const match = data.odds.find(o => o.price === bestOdds);
       if (match) bestBookmaker = match.bkTitle;
    }
    
    result.set(outcome, {
      fairProb,
      bestOdds,
      bookmakerCount: validOddsItems.length,
      consensusStrength,
      oddsArray,
      validOdds,
      bestBookmaker
    });
  }
  
  return result;
}


// ========== MOTOR PRINCIPAL ==========

export function extractValueBets(
  events: OddEvent[],
  minValueThreshold: number = 2.0,
  filterMainSports: boolean = true
): ValueBetOpportunity[] {
  const opportunities: ValueBetOpportunity[] = [];
  
  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;
    if (filterMainSports && !isMainSport(event.sport_key)) continue;

    const eventLabel = `${event.home_team} vs ${event.away_team}`;
    const h2hMap = parseH2HMarket(event);
    const totalsMap = parseTotalsMarket(event);

    const processMap = (marketMap: Map<string, ParsedMarketPick>, isH2H: boolean) => {
      for (const [pickLabel, data] of marketMap.entries()) {
        if (data.validOdds.length === 0) continue;
        const value = calculateValuePercentage(data.fairProb, data.bestOdds);
        if (value < minValueThreshold) continue;

        let market = 'Unknown';
        let pick = pickLabel;
        if (isH2H) {
           const isDrawPick = pickLabel === 'Draw' || pickLabel === 'Empate';
           pick = isDrawPick ? 'Empate' : `Gana ${pickLabel}`;
           market = isDrawPick ? 'Empate' : 'H2H';
        } else {
           market = 'Over/Under';
        }

        opportunities.push({
          eventId: event.id,
          event: eventLabel,
          pick,
          market,
          oddsMin: Math.min(...data.validOdds),
          oddsMax: Math.max(...data.validOdds),
          oddsBest: data.bestOdds,
          bestBookmaker: data.bestBookmaker,
          bookmakerCount: data.bookmakerCount,
          marketProbability: data.fairProb,
          valuePercentage: value,
          kellyStake: calculateKellyCriterion(data.fairProb, data.bestOdds, 0.25),
          consensusStrength: data.consensusStrength,
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
        });
      }
    };
    
    processMap(h2hMap, true);
    processMap(totalsMap, false);
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
  const opportunities: ValueBetOpportunity[] = [];
  
  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;
    if (filterMainSports && !isMainSport(event.sport_key)) continue;

    const eventLabel = `${event.home_team} vs ${event.away_team}`;
    const h2hMap = parseH2HMarket(event);
    const totalsMap = parseTotalsMarket(event);

    const processMap = (marketMap: Map<string, ParsedMarketPick>, isH2H: boolean) => {
      for (const [pickLabel, data] of marketMap.entries()) {
        if (data.validOdds.length === 0) continue;
        const value = calculateValuePercentage(data.fairProb, data.bestOdds);
        if (value < minValueThreshold) continue;

        let market = 'Unknown';
        let pick = pickLabel;
        if (isH2H) {
           const isDrawPick = pickLabel === 'Draw' || pickLabel === 'Empate';
           pick = isDrawPick ? 'Empate' : `Gana ${pickLabel}`;
           market = isDrawPick ? 'Empate' : 'H2H';
        } else {
           market = 'Over/Under';
        }

        opportunities.push({
          eventId: event.id,
          event: eventLabel,
          pick,
          market,
          oddsMin: Math.min(...data.validOdds),
          oddsMax: Math.max(...data.validOdds),
          oddsBest: data.bestOdds,
          bestBookmaker: data.bestBookmaker,
          bookmakerCount: data.bookmakerCount,
          marketProbability: data.fairProb,
          valuePercentage: value,
          kellyStake: calculateKellyCriterion(data.fairProb, data.bestOdds, 0.25),
          consensusStrength: data.consensusStrength,
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
        });
      }
    };
    
    processMap(h2hMap, true);
    processMap(totalsMap, false);
  }

  return opportunities.sort((a, b) => {
    const aPriority = a.oddsBest <= 2.00 ? 1 : 0;
    const bPriority = b.oddsBest <= 2.00 ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.valuePercentage - a.valuePercentage;
  });
}

// ========== ANÁLISIS DE MEJOR PICK POR PARTIDO ==========

/**
 * Analiza todos los mercados de un partido y devuelve EL MEJOR pick.
 * Esto es lo que el usuario ve en el Dashboard — la recomendación del analista.
 */
export function getSmartPicks(
  events: OddEvent[],
  filterMainSports: boolean = true
): SmartPick[] {
  const picks: SmartPick[] = [];

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) continue;
    if (filterMainSports && !isMainSport(event.sport_key)) continue;

    const eventLabel = `${event.home_team} vs ${event.away_team}`;
    let bestValue = 0;
    let bestPick: SmartPick | null = null;
    let fallbackPick: SmartPick | null = null;
    let lowestLoss = -Infinity;

    const h2hMap = parseH2HMarket(event);
    const totalsMap = parseTotalsMarket(event);

    const processMap = (marketMap: Map<string, ParsedMarketPick>, isH2H: boolean) => {
      for (const [pickLabel, data] of marketMap.entries()) {
        if (data.validOdds.length === 0) continue;
        const value = calculateValuePercentage(data.fairProb, data.bestOdds);
        
        let market = 'Unknown';
        let pick = pickLabel;
        if (isH2H) {
           const isDrawPick = pickLabel === 'Draw' || pickLabel === 'Empate';
           pick = isDrawPick ? 'Empate' : `Gana ${pickLabel}`;
           market = isDrawPick ? 'Empate' : 'H2H';
        } else {
           market = 'Over/Under';
        }

        const candidatePick: SmartPick = {
          eventId: event.id,
          event: eventLabel,
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
          bestPick: pick,
          bestMarket: market,
          oddsRange: data.validOdds.length > 1
            ? `${Math.min(...data.validOdds).toFixed(2)}–${Math.max(...data.validOdds).toFixed(2)}`
            : data.bestOdds.toFixed(2),
          bestOdds: data.bestOdds,
          valuePercentage: Math.max(0, value),
          kellyStake: calculateKellyCriterion(data.fairProb, data.bestOdds, 0.25),
          marketProbability: data.fairProb,
          confidence: value >= 5 ? 'alta' : value >= 2 ? 'media' : 'baja',
          bookmakerCount: data.bookmakerCount,
          consensusStrength: data.consensusStrength,
        };

        if (value > 0) {
          if (value > bestValue || !bestPick || bestPick.valuePercentage <= 0) {
            bestValue = value;
            bestPick = candidatePick;
          }
        } else {
          // If value <= 0, we track it for fallback just in case there is no pick with value
          const lossExpected = value; // since value is < 0, it represents the expected loss (-5% for example)
          if (lossExpected > lowestLoss) {
            lowestLoss = lossExpected;
            candidatePick.valuePercentage = 0;
            candidatePick.kellyStake = 0;
            candidatePick.confidence = 'baja';
            fallbackPick = Object.assign({}, candidatePick); // important to copy
          }
        }
      }
    };

    processMap(h2hMap, true);
    processMap(totalsMap, false);

    const bp = bestPick as SmartPick | null;
    const fp = fallbackPick as SmartPick | null;

    if (bp && bp.valuePercentage > 0) {
      picks.push(bp);
    } else if (!bp && fp) {
      // Solo como fallback si no hay absolutamente ningún pick con valor positivo
      picks.push(fp);
    } else if (bp) {
      // in case we pushed a negative value initially, though we shouldn't because of if(value > 0)
      bp.valuePercentage = 0;
      bp.kellyStake = 0;
      bp.confidence = 'baja';
      picks.push(bp);
    }
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
