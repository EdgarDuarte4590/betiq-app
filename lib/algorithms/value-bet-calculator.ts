/**
 * BetIQ Value Bet Calculator v3.1
 *
 * Motor profesional de análisis multi-bookmaker.
 * - Sistema de ZONAS DE CUOTAS con prioridad inteligente:
 *     Zona A (primaria)  : 1.50–1.95 → siempre prioridad máxima
 *     Zona B (secundaria): 1.96–2.50 → solo si value% >= SECONDARY_VALUE_THRESHOLD
 *     Zona C (alto valor): >2.50     → solo si value% >= HIGH_VALUE_THRESHOLD Y pinnacleAligns
 * - Limite diario configurable: 5–10 picks de alta calidad (getTopDailyPicks)
 * - Consolida resultados: UNA recomendación por partido/pick (no repetidas por casa)
 * - Muestra rango de cuotas (min–max) en vez de una por bookmaker
 * - Soporta: H2H (1X2 + Empate), Totals (Over/Under)
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
// Kelly minimum threshold: stakes below this % are not worth the effort
const KELLY_MIN_THRESHOLD = 0.5;

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
  const kellyPct = Math.min((f_star * fraction) * 100, 5); // Cap en 5% del bankroll por seguridad
  // Si el stake sugerido es menor al threshold mínimo, no vale la pena
  return kellyPct < KELLY_MIN_THRESHOLD ? 0 : kellyPct;
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
  consensusStrength: number; // 0-1: fracción de libros cuya prob fair supera el 50%
  pinnacleAligns: boolean;   // true si Pinnacle/Betfair respaldan el pick
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
  consensusStrength: number; // 0-1: fracción de libros que coinciden en el pick
  pinnacleAligns: boolean;   // true si sharp books respaldan el pick
  isFallback: boolean;       // true = no tiene value edge real, solo la mejor opción disponible
  isRecommended: boolean;    // true = cumple criterios estrictos (zonas/value) para notificación
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
  consensusStrength: number; // fraction of books whose fair prob > 0.5 for this outcome
  pinnacleAligns: boolean;   // whether sharp books (Pinnacle/Betfair) back this pick
  oddsArray: number[];
  validOdds: number[];
  bestBookmaker: string;
}

// Sharp books used for consensus validation
const SHARP_BOOK_KEYS = new Set(['pinnacle', 'betfair_ex_eu', 'betfair_ex_uk', 'bookmaker']);

// ========== SISTEMA DE ZONAS DE CUOTAS ==========
// Zona A (primaria)  : cuotas realistas con alta probabilidad implícita
// Zona B (secundaria): visibles solo con value estadístico real
// Zona C (alto valor): visibles solo con respaldo de sharp books
const ODDS_ZONE_A_MIN = 1.50;
const ODDS_ZONE_A_MAX = 1.95;
const ODDS_ZONE_B_MAX = 2.50;
const ODDS_ZONE_C_MAX = 5.00;

// Thresholds de value% para cuotas fuera de la zona primaria
const SECONDARY_VALUE_THRESHOLD = 5.0;  // Zona B: necesita al menos +5% de value
const HIGH_VALUE_THRESHOLD      = 10.0; // Zona C: necesita al menos +10% de value + pinnacle

/** Verifica si una cuota está en la zona primaria (1.50–1.95) */
export function isOddsZoneA(odds: number): boolean {
  return odds >= ODDS_ZONE_A_MIN && odds <= ODDS_ZONE_A_MAX;
}

/** Verifica si una cuota está en zona secundaria (1.96–2.50) */
export function isOddsZoneB(odds: number): boolean {
  return odds > ODDS_ZONE_A_MAX && odds <= ODDS_ZONE_B_MAX;
}

/** Verifica si una cuota está en zona alta (>2.50) */
export function isOddsZoneC(odds: number): boolean {
  return odds > ODDS_ZONE_B_MAX && odds <= ODDS_ZONE_C_MAX;
}

/**
 * Determina si una cuota es válida para mostrar dado el value y el respaldo de sharp books.
 * - Zona A (1.50–1.95): siempre válida si supera el minValue del caller
 * - Zona B (1.96–2.50): válida si value% >= SECONDARY_VALUE_THRESHOLD
 * - Zona C (>2.50)    : válida si value% >= HIGH_VALUE_THRESHOLD Y pinnacleAligns
 */
export function isOddsAcceptable(
  odds: number,
  valuePercentage: number,
  pinnacleAligns: boolean
): boolean {
  if (odds < ODDS_ZONE_A_MIN || odds > ODDS_ZONE_C_MAX) return false;
  if (isOddsZoneA(odds)) return true;
  if (isOddsZoneB(odds)) return valuePercentage >= SECONDARY_VALUE_THRESHOLD;
  if (isOddsZoneC(odds)) return valuePercentage >= HIGH_VALUE_THRESHOLD && pinnacleAligns;
  return false;
}

/**
 * Calcula la zona de una cuota como número (1=A, 2=B, 3=C).
 * Usado para el sorting: zona A siempre tiene prioridad.
 */
export function getOddsZone(odds: number): 1 | 2 | 3 {
  if (isOddsZoneA(odds)) return 1;
  if (isOddsZoneB(odds)) return 2;
  return 3;
}

// Alias interno para validación de rango mínimo (compatibilidad con helpers)
const MIN_ODDS = ODDS_ZONE_A_MIN;
const MAX_ODDS = ODDS_ZONE_C_MAX;

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
    
    // ── REAL Consensus: fracción de libros donde prob fair del outcome > 50% ──
    // Para cada libro que tiene prob map, verificamos si da probabilidad > 0.5 al outcome
    let booksAgreeing = 0;
    let booksTotal = 0;
    for (const odd of data.odds) {
      const probMap = bkFairProbs.get(odd.bkKey);
      if (probMap && probMap[outcome] !== undefined) {
        booksTotal++;
        if (probMap[outcome] > 0.5) booksAgreeing++; // majority-probability agreement
      }
    }
    const consensusStrength = booksTotal > 0 ? booksAgreeing / booksTotal : 0;

    // ── Sharp book alignment: ¿Pinnacle o Betfair respaldan el pick? ──
    let pinnacleAligns = false;
    for (const odd of data.odds) {
      if (SHARP_BOOK_KEYS.has(odd.bkKey)) {
        const probMap = bkFairProbs.get(odd.bkKey);
        if (probMap && (probMap[outcome] ?? 0) > 0.5) {
          pinnacleAligns = true;
          break;
        }
      }
    }
    
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
      pinnacleAligns,
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
    
    // ── REAL Consensus for totals ──
    let booksAgreeing = 0;
    let booksTotal = 0;
    for (const odd of data.odds) {
      const probMap = bkFairProbs.get(odd.bkKey);
      if (probMap && probMap[outcome] !== undefined) {
        booksTotal++;
        if (probMap[outcome] > 0.5) booksAgreeing++;
      }
    }
    const consensusStrength = booksTotal > 0 ? booksAgreeing / booksTotal : 0;

    // ── Sharp book alignment ──
    let pinnacleAligns = false;
    for (const odd of data.odds) {
      if (SHARP_BOOK_KEYS.has(odd.bkKey)) {
        const probMap = bkFairProbs.get(odd.bkKey);
        if (probMap && (probMap[outcome] ?? 0) > 0.5) {
          pinnacleAligns = true;
          break;
        }
      }
    }

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
      pinnacleAligns,
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
          pinnacleAligns: data.pinnacleAligns,
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

  // Filtrar: solo cuotas aceptables según el sistema de zonas
  const filtered = Array.from(bestPerEvent.values()).filter(op =>
    isOddsAcceptable(op.oddsBest, op.valuePercentage, op.pinnacleAligns)
  );

  // Ordenar: Zona A primero, luego Zona B, luego Zona C; dentro de cada zona por value%
  return filtered.sort((a, b) => {
    const zoneA = getOddsZone(a.oddsBest);
    const zoneB = getOddsZone(b.oddsBest);
    if (zoneA !== zoneB) return zoneA - zoneB; // Zona A (1) antes que B (2) antes que C (3)
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
          pinnacleAligns: data.pinnacleAligns,
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
        });
      }
    };
    
    processMap(h2hMap, true);
    processMap(totalsMap, false);
  }

  // Filtrar por zonas aceptables y ordenar
  return opportunities
    .filter(op => isOddsAcceptable(op.oddsBest, op.valuePercentage, op.pinnacleAligns))
    .sort((a, b) => {
      const zoneA = getOddsZone(a.oddsBest);
      const zoneB = getOddsZone(b.oddsBest);
      if (zoneA !== zoneB) return zoneA - zoneB;
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

        // ── Multi-factor confidence: value% + bookmakers count + sharp book alignment ──
        // Alta: value >= 5% Y (pinnacle align O 5+ books Y consensus > 0.7)
        // Media: value >= 2% O (baja value pero pinnacle align con 3+ books)
        // Baja: todo lo demás
        let confidence: 'alta' | 'media' | 'baja';
        if (value >= 5 && (data.pinnacleAligns || (data.bookmakerCount >= 5 && data.consensusStrength >= 0.7))) {
          confidence = 'alta';
        } else if (value >= 2 || (data.pinnacleAligns && data.bookmakerCount >= 3)) {
          confidence = 'media';
        } else {
          confidence = 'baja';
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
          confidence,
          bookmakerCount: data.bookmakerCount,
          consensusStrength: data.consensusStrength,
          pinnacleAligns: data.pinnacleAligns,
          isFallback: false, // Will be set to true below if no value edge
          isRecommended: false, // Will be set later
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
            candidatePick.isFallback = true;
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
      bp.isFallback = true;
      picks.push(bp);
    }
  }
  // Filtrar picks recomendados (los que pasan el estricto filtro de zonas/value)
  const acceptablePicks = picks.filter(p => {
    p.isRecommended = isOddsAcceptable(p.bestOdds, p.valuePercentage, p.pinnacleAligns);
    return p.isRecommended;
  });

  return acceptablePicks.sort((a, b) => {
    // 1. Picks con value real antes que fallbacks
    if (a.valuePercentage > 0 && b.valuePercentage <= 0) return -1;
    if (b.valuePercentage > 0 && a.valuePercentage <= 0) return 1;
    // 2. Zona A antes que B antes que C
    const zoneA = getOddsZone(a.bestOdds);
    const zoneB = getOddsZone(b.bestOdds);
    if (zoneA !== zoneB) return zoneA - zoneB;
    // 3. Dentro de la misma zona, por value%
    return b.valuePercentage - a.valuePercentage;
  });
}

// ========== INTEGRACIÓN DE APIs (FASE 3) ==========

import { getTeamForm } from '@/lib/apis/sofascore';
// import { searchNBATeam, getNBATeamRecord } from '@/lib/apis/balldontlie';

/**
 * Enriquece asíncronamente los picks recomendados con estadísticas de SofaScore (y BallDontLie en el futuro).
 * Si la API reporta una racha ganadora fuerte (>70%), eleva la confianza a 'alta'.
 */
export async function enrichPicksWithStats(picks: SmartPick[]): Promise<SmartPick[]> {
  // Solo procesar un máximo de picks para no quemar cuotas de la API muy rápido
  const picksToEnrich = picks.slice(0, 15);
  
  const enrichedPicks = await Promise.all(picksToEnrich.map(async (pick) => {
    // Si ya es 'alta', o si no tiene valor positivo, no gastamos peticiones a la API
    if (pick.confidence === 'alta' || pick.valuePercentage <= 0) {
      return pick;
    }

    // Identificar de qué equipo apostamos a que gana (Gana X)
    const matchGana = pick.bestPick.match(/Gana (.+)/);
    if (matchGana && matchGana[1]) {
      const teamName = matchGana[1];
      
      // Llamada asíncrona a SofaScore (caché gestionado en la API)
      const form = await getTeamForm(teamName);
      
      if (form && form.winPercentage >= 70) {
        // Boost de confianza por buena racha!
        return {
          ...pick,
          confidence: 'alta' as const,
          // Agregamos un pequeño tooltip mental: el equipo viene muy bien
          bestPick: `${pick.bestPick} 🔥`
        };
      }
    }
    
    // Si no hubo boost, retornamos el pick original
    return pick;
  }));

  // Los picks que no procesamos (si había más de 15) los dejamos igual
  const rest = picks.slice(15);
  return [...enrichedPicks, ...rest];
}


// ========== PICKS DIARIOS CON FILTRO DE CALIDAD ==========

export interface DailyPicksConfig {
  minPicks?: number;  // Mínimo de picks a mostrar (default: 5)
  maxPicks?: number;  // Máximo de picks a mostrar (default: 10)
  requireHighConfidence?: boolean; // Si true, solo 'alta'. Default: false (alta + media)
}

/**
 * Calcula un score ponderado para rankear picks diarios.
 * Combina: value%, consenso, respaldo de sharp books y zona de cuotas.
 */
function calculatePickScore(pick: SmartPick): number {
  const valueScore      = Math.min(pick.valuePercentage, 20) * 2;     // 0–40 pts
  const consensusScore  = pick.consensusStrength * 20;                 // 0–20 pts
  const pinnacleBonus   = pick.pinnacleAligns ? 15 : 0;               // 0–15 pts
  const confidenceBonus = pick.confidence === 'alta' ? 20
                        : pick.confidence === 'media' ? 10 : 0;       // 0–20 pts
  const zoneBonus       = isOddsZoneA(pick.bestOdds) ? 5 : 0;        // +5 si está en zona primaria
  return valueScore + consensusScore + pinnacleBonus + confidenceBonus + zoneBonus;
}

/**
 * Filtra y limita los smart picks a un rango de 5–10 picks de alta calidad.
 * 
 * Lógica:
 * 1. Descarta picks sin value real (isFallback) si hay suficientes con value positivo
 * 2. Ordena por score ponderado (value + consenso + sharp books + zona)
 * 3. Aplica límite de maxPicks
 * 4. Si no hay suficientes de confianza alta/media, incluye 'baja' hasta alcanzar minPicks
 */
export function getTopDailyPicks(
  events: OddEvent[],
  config: DailyPicksConfig = {}
): SmartPick[] {
  const {
    minPicks = 5,
    maxPicks = 10,
    requireHighConfidence = false,
  } = config;

  // Obtener todos los smart picks con el filtro de zonas ya aplicado
  const allPicks = getSmartPicks(events, true);

  // Separar por calidad (Solo de los recomendados)
  const highQuality = allPicks.filter(p =>
    p.isRecommended && p.valuePercentage > 0 &&
    (requireHighConfidence
      ? p.confidence === 'alta'
      : p.confidence === 'alta' || p.confidence === 'media')
  );

  const lowQuality = allPicks.filter(p =>
    p.isRecommended && !highQuality.includes(p) && p.valuePercentage > 0
  );

  // Ordenar cada grupo por score ponderado
  const sortedHigh = highQuality.sort((a, b) => calculatePickScore(b) - calculatePickScore(a));
  const sortedLow  = lowQuality.sort((a, b) => calculatePickScore(b) - calculatePickScore(a));

  // Tomar hasta maxPicks de alta calidad
  let result = sortedHigh.slice(0, maxPicks);

  // Si quedamos por debajo del mínimo, completar con picks de calidad baja
  if (result.length < minPicks) {
    const needed = minPicks - result.length;
    result = [...result, ...sortedLow.slice(0, needed)];
  }

  return result;
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
