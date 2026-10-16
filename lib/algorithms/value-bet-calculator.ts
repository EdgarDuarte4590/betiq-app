/**
 * BetIQ Quantitative Value Bet Calculator v4.0
 *
 * Motor cuantitativo institucional multi-bookmaker:
 * - Power Method Devigging (búsqueda binaria en 15 iteraciones) para corregir el Favorite-Longshot Bias
 * - Consenso Sharp Ponderado: Pinnacle (50%), Betfair Exchange / Matchbook (30%), Circa / Bookmaker (20%)
 * - Fallback por Media Armónica de las 4 casas con menor overround (margen) cuando no hay casa sharp directa
 * - Criterio de Kelly Fraccionado (Quarter Kelly α = 0.25) con Hard Cap del 3% del bankroll por pick
 * - Kelly Simultáneo con ajuste automático de exposición (>15% bankroll comprometido en PENDING)
 * - Degradación elegante (Graceful Degradation) con timeout estricto (<3s) para proveedores secundarios
 */

import type { OddEvent } from '@/lib/apis/odds-api';
import { getTeamForm } from '@/lib/apis/sofascore';
import { searchNBATeam, getNBATeamRecord } from '@/lib/apis/balldontlie';

// ========== CONFIGURACIÓN DE CONSENSO SHARP PONDERADO ==========

/**
 * Pesos de madurez de mercado para el Consenso Sharp Institucional:
 * - Pinnacle: 50% (0.50)
 * - Betfair Exchange / Matchbook: 30% (0.30)
 * - Circa / Bookmaker / LowVig: 20% (0.20)
 */
const SHARP_TIER_WEIGHTS: Record<string, number> = {
  'pinnacle':         0.50,
  'betfair_ex_eu':    0.30,
  'betfair_ex_uk':    0.30,
  'betfair_ex_au':    0.30,
  'matchbook':        0.30,
  'bookmaker':        0.20,
  'circa':            0.20,
  'lowvig':           0.20,
};

const SHARP_BOOK_KEYS = new Set(Object.keys(SHARP_TIER_WEIGHTS));

// Pesos generales para telemetría / ponderación secundaria
const BOOKMAKER_WEIGHTS: Record<string, number> = {
  'pinnacle':         3.0,
  'betfair_ex_eu':    2.5,
  'betfair_ex_uk':    2.5,
  'matchbook':        2.5,
  'bookmaker':        2.0,
  'betsson':          1.5,
  'unibet_eu':        1.5,
  'williamhill':      1.3,
  'bet365':           1.2,
  'draftkings':       0.8,
  'fanduel':          0.8,
  'bovada':           0.7,
};

export function getBookmakerWeight(bookmakerKey: string): number {
  return BOOKMAKER_WEIGHTS[bookmakerKey] ?? 1.0;
}

// ========== FÓRMULAS CUANTITATIVAS (POWER METHOD DEVIGGING & KELLY) ==========

/**
 * Power Method Devigging:
 * Dadas las cuotas decimales O_1, O_2, ..., O_n con margen bruto sum(1/O_i) > 1,
 * resuelve numéricamente mediante búsqueda binaria en 15 iteraciones el exponente
 * de potencia k > 1 tal que:
 *   sum_{i=1}^n (1 / O_i)^k = 1
 *
 * Corrige el Favorite-Longshot Bias donde las casas cargan mayor margen relativo
 * en los underdogs/longshots que en los favoritos.
 */
export function powerDevig(odds: number[]): number[] {
  if (!odds || odds.length === 0) return [];
  const validOdds = odds.map(o => (o > 1.0001 ? o : 1.0001));
  const impliedProbs = validOdds.map(o => 1 / o);
  const grossOverround = impliedProbs.reduce((s, p) => s + p, 0);

  if (grossOverround <= 0) return odds.map(() => 0);

  // Si no hay overround (> 1), normalizar multiplicativamente
  if (grossOverround <= 1.0001) {
    return impliedProbs.map(p => p / grossOverround);
  }

  // Búsqueda binaria en 15 iteraciones para hallar k > 1 tal que sum((1/O_i)^k) = 1
  let low = 1.0;
  let high = 15.0;

  for (let iter = 0; iter < 15; iter++) {
    const mid = (low + high) / 2;
    let sumPow = 0;
    for (let i = 0; i < impliedProbs.length; i++) {
      sumPow += Math.pow(impliedProbs[i], mid);
    }
    if (sumPow > 1.0) {
      // Necesitamos un exponente mayor para reducir probabilidades en (0,1)
      low = mid;
    } else {
      high = mid;
    }
  }

  const k = (low + high) / 2;
  const rawTrueProbs = impliedProbs.map(p => Math.pow(p, k));
  const normSum = rawTrueProbs.reduce((s, p) => s + p, 0) || 1;
  return rawTrueProbs.map(p => p / normSum);
}

/**
 * Elimina el overround (margen del bookmaker) de un conjunto de cuotas decimales
 * utilizando Power Method Devigging institucional.
 */
export function removeVig(odds: number[]): number[] {
  return powerDevig(odds);
}

/**
 * Calcula el Valor Esperado en porcentaje:
 * EV% = ((P_true * O_soft) - 1) * 100
 */
export function calculateValuePercentage(winProbability: number, decimalOdds: number): number {
  if (winProbability <= 0 || decimalOdds <= 1) return 0;
  return ((winProbability * decimalOdds) - 1) * 100;
}

// Kelly minimum threshold (%) y Hard Cap institucional (3.0% del bankroll por pick)
const KELLY_MIN_THRESHOLD = 0.25;
export const KELLY_HARD_CAP_PCT = 3.0;

/**
 * Criterio de Kelly Fraccionado (Quarter Kelly α = 0.25 por defecto)
 * con límite máximo de exposición (Hard Cap) del 3.0% del bankroll por pick.
 *
 * f* = α * max(0, (P_true * (O_soft - 1) - (1 - P_true)) / (O_soft - 1))
 */
export function calculateKellyCriterion(
  winProbability: number,
  decimalOdds: number,
  fraction: number = 0.25
): number {
  if (winProbability <= 0 || winProbability >= 1 || decimalOdds <= 1) return 0;

  const b = decimalOdds - 1;
  const q = 1 - winProbability;
  const fStar = ((winProbability * b) - q) / b;

  if (fStar <= 0) return 0;

  const kellyPct = Math.min(fStar * fraction * 100, KELLY_HARD_CAP_PCT);
  return kellyPct < KELLY_MIN_THRESHOLD ? 0 : Number(kellyPct.toFixed(2));
}

/**
 * Kelly Simultáneo: ajusta el stake recomendado según la exposición actual del usuario
 * en apuestas PENDING. Si el usuario tiene más del 15% del bankroll comprometido,
 * reduce proporcionalmente la exposición para proteger contra riesgo de ruina correlacionado.
 */
export function calculateSimultaneousKelly(
  baseKellyPct: number,
  bankroll: number,
  pendingExposureCurrency: number = 0
): {
  adjustedKellyPct: number;
  recommendedStakeCurrency: number;
  recommendedUnits: number; // 1 Unidad = 1% del bankroll
  exposureRatio: number;
  isReducedByExposure: boolean;
} {
  const safeBankroll = bankroll > 0 ? bankroll : 1000;
  const exposureRatio = safeBankroll > 0 ? pendingExposureCurrency / safeBankroll : 0;

  let scaleFactor = 1.0;
  let isReducedByExposure = false;

  // Si hay más del 15% del bankroll comprometido en apuestas PENDING, escalar hacia abajo
  if (exposureRatio > 0.15) {
    isReducedByExposure = true;
    // Reducción progresiva: a 15% factor=1.0, a 50%+ factor=0.35
    scaleFactor = Math.max(0.35, 1 - (exposureRatio - 0.15) * 1.5);
  }

  const adjustedKellyPct = Math.min(
    KELLY_HARD_CAP_PCT,
    Number((baseKellyPct * scaleFactor).toFixed(2))
  );
  const recommendedStakeCurrency = Number(((safeBankroll * adjustedKellyPct) / 100).toFixed(2));
  const recommendedUnits = Number(adjustedKellyPct.toFixed(2));

  return {
    adjustedKellyPct,
    recommendedStakeCurrency,
    recommendedUnits,
    exposureRatio,
    isReducedByExposure,
  };
}

// ========== TYPES ==========

export interface ValueBetOpportunity {
  eventId: string;
  event: string;
  pick: string;
  market: string;           // 'H2H', 'Empate', 'Over/Under'
  oddsMin: number;          // Cuota más baja del mercado
  oddsMax: number;          // Cuota más alta
  oddsBest: number;         // Mejor cuota disponible (O_soft)
  fairOdds: number;         // Cuota justa sin margen (1 / P_true)
  bestBookmaker: string;    // Casa que ofrece la mejor cuota
  bookmakerCount: number;   // Cuántas casas ofrecen este pick
  marketProbability: number;// P_true calculada por Consenso Sharp + Power Devigging
  valuePercentage: number;  // EV%
  kellyStake: number;       // Quarter Kelly % (cap 3%)
  consensusStrength: number;// 0-1: fuerza de acuerdo del mercado
  pinnacleAligns: boolean;  // true si casas sharp respaldan el valor o favoritismo
  usedSharpConsensus: boolean; // true si había casa sharp directa, false si usó media armónica
  isSteamMove?: boolean;    // true si se detectó caída brusca en sharp books (>4% en <30m)
  steamMoveDelta?: number;  // magnitud del movimiento de probabilidad implícita (%)
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
  bestPick: string;         // "Gana Arsenal", "Over 2.5", "Empate"
  bestMarket: string;       // "H2H", "Over/Under", "Empate"
  oddsRange: string;        // "1.85–2.10"
  bestOdds: number;
  fairOdds: number;         // Cuota justa sin margen (1 / P_true)
  bestBookmaker: string;    // Casa de apuestas con la mejor cuota
  valuePercentage: number;
  kellyStake: number;
  marketProbability: number;
  confidence: 'alta' | 'media' | 'baja';
  bookmakerCount: number;
  consensusStrength: number;
  pinnacleAligns: boolean;
  usedSharpConsensus?: boolean;
  isSteamMove?: boolean;
  steamMoveDelta?: number;
  isFallback: boolean;
  isRecommended: boolean;
}

// ========== DEPORTES PRINCIPALES ==========

const MAIN_SPORTS = [
  'soccer', 'basketball', 'baseball',
];

export function isMainSport(sportKey: string): boolean {
  return MAIN_SPORTS.some(s => sportKey.includes(s));
}

/**
 * Verifica si un evento se juega hoy en zona horaria de México (CST).
 */
export function isTodayInMexico(commenceTime: string): boolean {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' });
  const todayStr = formatter.format(new Date());
  const eventStr = formatter.format(new Date(commenceTime));
  return eventStr === todayStr;
}

// ========== SISTEMA DE ZONAS DE CUOTAS ==========

const ODDS_ZONE_A_MIN = 1.45;
const ODDS_ZONE_A_MAX = 1.95;
const ODDS_ZONE_B_MAX = 2.60;
const ODDS_ZONE_C_MAX = 5.50;

const SECONDARY_VALUE_THRESHOLD = 3.0; // Zona B: al menos +3.0% EV
const HIGH_VALUE_THRESHOLD      = 6.5; // Zona C: al menos +6.5% EV + respaldo sharp

/** Verifica si una cuota está en la zona primaria (1.45–1.95) */
export function isOddsZoneA(odds: number): boolean {
  return odds >= ODDS_ZONE_A_MIN && odds <= ODDS_ZONE_A_MAX;
}

/** Verifica si una cuota está en zona secundaria (1.96–2.60) */
export function isOddsZoneB(odds: number): boolean {
  return odds > ODDS_ZONE_A_MAX && odds <= ODDS_ZONE_B_MAX;
}

/** Verifica si una cuota está en zona alta (2.61–5.50) */
export function isOddsZoneC(odds: number): boolean {
  return odds > ODDS_ZONE_B_MAX && odds <= ODDS_ZONE_C_MAX;
}

/**
 * Determina si una cuota es válida según zona, EV% y respaldo sharp.
 */
export function isOddsAcceptable(
  odds: number,
  valuePercentage: number,
  pinnacleAligns: boolean
): boolean {
  if (odds < ODDS_ZONE_A_MIN || odds > ODDS_ZONE_C_MAX) return false;
  if (isOddsZoneA(odds)) return valuePercentage > 0;
  if (isOddsZoneB(odds)) return valuePercentage >= SECONDARY_VALUE_THRESHOLD;
  if (isOddsZoneC(odds)) return valuePercentage >= HIGH_VALUE_THRESHOLD && pinnacleAligns;
  return false;
}

export function getOddsZone(odds: number): 1 | 2 | 3 {
  if (isOddsZoneA(odds)) return 1;
  if (isOddsZoneB(odds)) return 2;
  return 3;
}

const MIN_ODDS = ODDS_ZONE_A_MIN;
const MAX_ODDS = ODDS_ZONE_C_MAX;

// ========== CONSENSO SHARP PONDERADO Y MEDIA ARMÓNICA ==========

interface BookmakerMarketDevig {
  bkKey: string;
  bkTitle: string;
  overround: number; // margen bruto sum(1/O_i)
  probs: Record<string, number>; // Power-devigged P_true por outcome
}

/**
 * Calcula la probabilidad real limpia (P_true) para cada outcome combinando:
 * 1. Consenso Sharp Ponderado: Pinnacle (50%), Betfair/Matchbook (30%), Circa/Bookmaker (20%)
 * 2. Fallback por Media Armónica de las 4 casas con menor margen (overround) si no hay casa sharp directa.
 */
function computeConsensusTrueProbabilities(
  deviggedBooks: BookmakerMarketDevig[],
  outcomes: string[]
): {
  trueProbs: Record<string, number>;
  usedSharpConsensus: boolean;
  sharpProbsByBook: Map<string, Record<string, number>>;
} {
  const sharpProbsByBook = new Map<string, Record<string, number>>();
  const sharpBooksPresent = deviggedBooks.filter(b => SHARP_BOOK_KEYS.has(b.bkKey));

  for (const sb of sharpBooksPresent) {
    sharpProbsByBook.set(sb.bkKey, sb.probs);
  }

  const rawProbs: Record<string, number> = {};

  if (sharpBooksPresent.length > 0) {
    // 1. Consenso Sharp Ponderado (Pinnacle 50%, Betfair/Matchbook 30%, Circa/Bookmaker 20%)
    for (const outcome of outcomes) {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const sb of sharpBooksPresent) {
        const p = sb.probs[outcome];
        if (p !== undefined && p > 0) {
          const w = SHARP_TIER_WEIGHTS[sb.bkKey] ?? 0.20;
          weightedSum += p * w;
          weightTotal += w;
        }
      }
      rawProbs[outcome] = weightTotal > 0 ? weightedSum / weightTotal : 0;
    }

    // Normalizar para garantizar que sum(P_true) === 1
    const sum = Object.values(rawProbs).reduce((s, p) => s + p, 0);
    if (sum > 0) {
      for (const outcome of outcomes) {
        rawProbs[outcome] = rawProbs[outcome] / sum;
      }
      return { trueProbs: rawProbs, usedSharpConsensus: true, sharpProbsByBook };
    }
  }

  // 2. Fallback: Media Armónica de las 4 casas con menor margen (overround)
  const lowestMarginBooks = [...deviggedBooks]
    .sort((a, b) => a.overround - b.overround)
    .slice(0, 4);

  for (const outcome of outcomes) {
    let reciprocalSum = 0;
    let count = 0;
    for (const bk of lowestMarginBooks) {
      const p = bk.probs[outcome];
      if (p !== undefined && p > 0.0001) {
        reciprocalSum += 1 / p;
        count++;
      }
    }
    rawProbs[outcome] = count > 0 && reciprocalSum > 0 ? count / reciprocalSum : 0;
  }

  const totalHarmonic = Object.values(rawProbs).reduce((s, p) => s + p, 0);
  if (totalHarmonic > 0) {
    for (const outcome of outcomes) {
      rawProbs[outcome] = rawProbs[outcome] / totalHarmonic;
    }
  }

  return { trueProbs: rawProbs, usedSharpConsensus: false, sharpProbsByBook };
}

// ========== HELPERS DE MERCADOS ==========

interface ParsedMarketPick {
  fairProb: number;
  fairOdds: number;
  bestOdds: number;
  bookmakerCount: number;
  consensusStrength: number;
  pinnacleAligns: boolean;
  usedSharpConsensus: boolean;
  oddsArray: number[];
  validOdds: number[];
  bestBookmaker: string;
}

function buildParsedMarketPicks(
  deviggedBooks: BookmakerMarketDevig[],
  outcomeOddsMap: Map<string, { price: number; bkKey: string; bkTitle: string }[]>
): Map<string, ParsedMarketPick> {
  const outcomes = Array.from(outcomeOddsMap.keys());
  const { trueProbs, usedSharpConsensus, sharpProbsByBook } = computeConsensusTrueProbabilities(
    deviggedBooks,
    outcomes
  );

  const bkFairProbs = new Map<string, Record<string, number>>();
  for (const b of deviggedBooks) {
    bkFairProbs.set(b.bkKey, b.probs);
  }

  const result = new Map<string, ParsedMarketPick>();

  for (const [outcome, oddsList] of outcomeOddsMap.entries()) {
    const fairProb = trueProbs[outcome] ?? 0;
    if (fairProb <= 0) continue;

    const fairOdds = Number((1 / fairProb).toFixed(3));
    const validOddsItems = oddsList.filter(o => o.price >= MIN_ODDS && o.price <= MAX_ODDS);
    const oddsArray = oddsList.map(o => o.price);
    const validOdds = validOddsItems.map(o => o.price);

    let bestOdds = 0;
    let bestBookmaker = 'N/A';
    if (validOddsItems.length > 0) {
      let bestItem = validOddsItems[0];
      for (const item of validOddsItems) {
        if (item.price > bestItem.price) bestItem = item;
      }
      bestOdds = bestItem.price;
      bestBookmaker = bestItem.bkTitle;
    } else if (oddsList.length > 0) {
      bestOdds = Math.max(...oddsArray);
      const match = oddsList.find(o => o.price === bestOdds);
      if (match) bestBookmaker = match.bkTitle;
    }

    const impliedBest = bestOdds > 1 ? 1 / bestOdds : 1;

    // ── Consenso de Mercado: fracción de libros cuya prob justa respalda el valor o favoritismo ──
    let booksAgreeing = 0;
    let booksTotal = 0;
    for (const odd of oddsList) {
      const probMap = bkFairProbs.get(odd.bkKey);
      const bookFairProb = probMap?.[outcome];
      if (bookFairProb !== undefined) {
        booksTotal++;
        // Un libro acuerda con el pick si su prob justa supera la prob implícita de la mejor cuota
        // o está dentro del 1.5% del consenso real o > 50%
        if (bookFairProb >= impliedBest || bookFairProb >= fairProb * 0.97 || bookFairProb > 0.5) {
          booksAgreeing++;
        }
      }
    }
    const consensusStrength = booksTotal > 0 ? booksAgreeing / booksTotal : 0;

    // ── Respaldo Sharp (Pinnacle / Betfair / Matchbook / Bookmaker) ──
    let pinnacleAligns = false;
    for (const [, sharpProbs] of sharpProbsByBook.entries()) {
      const sp = sharpProbs[outcome];
      if (sp !== undefined) {
        // La casa sharp respalda el pick si su probabilidad limpia genera EV positivo en bestOdds
        // o si considera al outcome favorito (> 50%)
        if (sp * bestOdds > 1.005 || sp > 0.5) {
          pinnacleAligns = true;
          break;
        }
      }
    }

    // Si no hubo casa sharp en el evento pero el consenso por media armónica de las 4 casas más eficientes
    // muestra acuerdo >= 75% y al menos 4 casas, permitir alineamiento por consenso eficiente
    if (!pinnacleAligns && !usedSharpConsensus && validOddsItems.length >= 4 && consensusStrength >= 0.75 && fairProb * bestOdds > 1.03) {
      pinnacleAligns = true;
    }

    result.set(outcome, {
      fairProb,
      fairOdds,
      bestOdds,
      bookmakerCount: validOddsItems.length,
      consensusStrength,
      pinnacleAligns,
      usedSharpConsensus,
      oddsArray,
      validOdds,
      bestBookmaker,
    });
  }

  return result;
}

function parseH2HMarket(event: OddEvent): Map<string, ParsedMarketPick> {
  const deviggedBooks: BookmakerMarketDevig[] = [];
  const outcomeOddsMap = new Map<string, { price: number; bkKey: string; bkTitle: string }[]>();

  for (const bk of event.bookmakers) {
    const h2h = bk.markets?.find(m => m.key === 'h2h');
    if (!h2h?.outcomes || h2h.outcomes.length < 2) continue;

    const prices = h2h.outcomes.map(o => o.price);
    const names = h2h.outcomes.map(o => o.name);
    const overround = prices.reduce((s, p) => s + (p > 1 ? 1 / p : 0), 0);
    const fairProbs = powerDevig(prices);

    const probMap: Record<string, number> = {};
    for (let i = 0; i < names.length; i++) {
      probMap[names[i]] = fairProbs[i];
      if (!outcomeOddsMap.has(names[i])) outcomeOddsMap.set(names[i], []);
      outcomeOddsMap.get(names[i])!.push({ price: prices[i], bkKey: bk.key, bkTitle: bk.title });
    }

    deviggedBooks.push({
      bkKey: bk.key,
      bkTitle: bk.title,
      overround,
      probs: probMap,
    });
  }

  if (deviggedBooks.length === 0) return new Map();
  return buildParsedMarketPicks(deviggedBooks, outcomeOddsMap);
}

function parseTotalsMarket(event: OddEvent): Map<string, ParsedMarketPick> {
  // Agrupar por línea de puntos (ej. "2.5", "8.5") para hacer Power Devigging par-a-par (Over vs Under)
  const lineGroups = new Map<string, {
    deviggedBooks: BookmakerMarketDevig[];
    outcomeOddsMap: Map<string, { price: number; bkKey: string; bkTitle: string }[]>;
  }>();

  for (const bk of event.bookmakers) {
    const totals = bk.markets?.find(m => m.key === 'totals');
    if (!totals?.outcomes || totals.outcomes.length < 2) continue;

    const pointsMap = new Map<string, { name: string; price: number }[]>();
    for (const o of totals.outcomes) {
      const point = o.point !== undefined && o.point !== null ? String(o.point) : 'default';
      if (!pointsMap.has(point)) pointsMap.set(point, []);
      pointsMap.get(point)!.push({ name: o.name, price: o.price });
    }

    for (const [point, group] of pointsMap.entries()) {
      if (group.length < 2) continue;
      if (!lineGroups.has(point)) {
        lineGroups.set(point, { deviggedBooks: [], outcomeOddsMap: new Map() });
      }
      const lineEntry = lineGroups.get(point)!;

      const prices = group.map(x => x.price);
      const overround = prices.reduce((s, p) => s + (p > 1 ? 1 / p : 0), 0);
      const fairProbs = powerDevig(prices);
      const probMap: Record<string, number> = {};

      for (let i = 0; i < group.length; i++) {
        const label = `${group[i].name} ${point === 'default' ? '' : point}`.trim();
        probMap[label] = fairProbs[i];
        if (!lineEntry.outcomeOddsMap.has(label)) lineEntry.outcomeOddsMap.set(label, []);
        lineEntry.outcomeOddsMap.get(label)!.push({
          price: group[i].price,
          bkKey: bk.key,
          bkTitle: bk.title,
        });
      }

      lineEntry.deviggedBooks.push({
        bkKey: bk.key,
        bkTitle: bk.title,
        overround,
        probs: probMap,
      });
    }
  }

  const combinedResult = new Map<string, ParsedMarketPick>();
  for (const [, lineEntry] of lineGroups.entries()) {
    if (lineEntry.deviggedBooks.length === 0) continue;
    const parsedLine = buildParsedMarketPicks(lineEntry.deviggedBooks, lineEntry.outcomeOddsMap);
    for (const [k, v] of parsedLine.entries()) {
      combinedResult.set(k, v);
    }
  }

  return combinedResult;
}

// ========== MOTOR PRINCIPAL ==========

export function extractValueBets(
  events: OddEvent[],
  minValueThreshold: number = 2.0,
  filterMainSports: boolean = true
): ValueBetOpportunity[] {
  const all = extractAllValueBets(events, minValueThreshold, filterMainSports);

  // Deduplicar: solo la MEJOR selección aceptable por partido
  const bestPerEvent = new Map<string, ValueBetOpportunity>();
  for (const op of all) {
    const existing = bestPerEvent.get(op.eventId);
    if (!existing || op.valuePercentage > existing.valuePercentage) {
      bestPerEvent.set(op.eventId, op);
    }
  }

  return Array.from(bestPerEvent.values()).sort((a, b) => {
    const zoneA = getOddsZone(a.oddsBest);
    const zoneB = getOddsZone(b.oddsBest);
    if (zoneA !== zoneB) return zoneA - zoneB;
    return b.valuePercentage - a.valuePercentage;
  });
}

/**
 * Versión expandida: muestra TODAS las oportunidades por partido (para Value Bets Scanner).
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
          fairOdds: data.fairOdds,
          bestBookmaker: data.bestBookmaker,
          bookmakerCount: data.bookmakerCount,
          marketProbability: data.fairProb,
          valuePercentage: value,
          kellyStake: calculateKellyCriterion(data.fairProb, data.bestOdds, 0.25),
          consensusStrength: data.consensusStrength,
          pinnacleAligns: data.pinnacleAligns,
          usedSharpConsensus: data.usedSharpConsensus,
          sport: event.sport_key,
          league: event.sport_title,
          commenceTime: event.commence_time,
        });
      }
    };

    processMap(h2hMap, true);
    processMap(totalsMap, false);
  }

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
 * Analiza todos los mercados de un partido y devuelve EL MEJOR pick que cumpla
 * con las reglas de zona e integridad cuantitativa.
 *
 * IMPORTANTE: Evalúa `isOddsAcceptable` ANTES de elegir el mejor pick del partido,
 * evitando que un longshot de Zona C (que luego sería rechazado) sobrescriba un
 * Value Bet válido de Zona A o Zona B.
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
    let bestAcceptablePick: SmartPick | null = null;
    let bestAcceptableScore = -Infinity;

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

        // Clasificación multifactorial de confianza
        let confidence: 'alta' | 'media' | 'baja';
        if (
          value >= 4.0 &&
          (data.pinnacleAligns || (data.bookmakerCount >= 4 && data.consensusStrength >= 0.65))
        ) {
          confidence = 'alta';
        } else if (value >= 1.5 || (data.pinnacleAligns && data.bookmakerCount >= 3 && value > 0)) {
          confidence = 'media';
        } else {
          confidence = 'baja';
        }

        const acceptable = isOddsAcceptable(data.bestOdds, value, data.pinnacleAligns);

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
          fairOdds: data.fairOdds,
          bestBookmaker: data.bestBookmaker,
          valuePercentage: Math.max(0, value),
          kellyStake: calculateKellyCriterion(data.fairProb, data.bestOdds, 0.25),
          marketProbability: data.fairProb,
          confidence,
          bookmakerCount: data.bookmakerCount,
          consensusStrength: data.consensusStrength,
          pinnacleAligns: data.pinnacleAligns,
          usedSharpConsensus: data.usedSharpConsensus,
          isFallback: value <= 0,
          isRecommended: acceptable,
        };

        if (acceptable && value > 0) {
          // Priorizar Zona A/B y mayor EV ponderado
          const zoneBonus = isOddsZoneA(data.bestOdds) ? 3 : isOddsZoneB(data.bestOdds) ? 1.5 : 0;
          const sharpBonus = data.pinnacleAligns ? 2 : 0;
          const candidateScore = value + zoneBonus + sharpBonus;

          if (candidateScore > bestAcceptableScore) {
            bestAcceptableScore = candidateScore;
            bestAcceptablePick = candidatePick;
          }
        }
      }
    };

    processMap(h2hMap, true);
    processMap(totalsMap, false);

    if (bestAcceptablePick) {
      picks.push(bestAcceptablePick);
    }
  }

  return picks.sort((a, b) => {
    const zoneA = getOddsZone(a.bestOdds);
    const zoneB = getOddsZone(b.bestOdds);
    if (zoneA !== zoneB) return zoneA - zoneB;
    return b.valuePercentage - a.valuePercentage;
  });
}

/**
 * Diagnóstico forense de descarte por evento para el embudo de telemetría (`funnel_diagnostics`).
 */
export function diagnoseEventsFunnel(
  events: OddEvent[],
  minAlertValue: number = 3.5
): {
  valueBetsCalculated: SmartPick[];
  passedThresholdFilters: SmartPick[];
  discardReasons: {
    insufficient_bookmakers: number;
    non_main_sport: number;
    missing_sharp_book: number;
    ev_too_low: number;
    odds_out_of_zone: number;
  };
} {
  const discardReasons = {
    insufficient_bookmakers: 0,
    non_main_sport: 0,
    missing_sharp_book: 0,
    ev_too_low: 0,
    odds_out_of_zone: 0,
  };

  for (const event of events) {
    if (!event.bookmakers || event.bookmakers.length < 2) {
      discardReasons.insufficient_bookmakers++;
      continue;
    }
    if (!isMainSport(event.sport_key)) {
      discardReasons.non_main_sport++;
      continue;
    }

    const h2hMap = parseH2HMarket(event);
    const totalsMap = parseTotalsMarket(event);
    const allOutcomes = [...h2hMap.values(), ...totalsMap.values()];

    if (allOutcomes.length === 0) {
      discardReasons.insufficient_bookmakers++;
      continue;
    }

    const hasSharp = allOutcomes.some(o => o.usedSharpConsensus);
    if (!hasSharp) {
      discardReasons.missing_sharp_book++;
    }

    const hasPositiveEv = allOutcomes.some(o => calculateValuePercentage(o.fairProb, o.bestOdds) > 0);
    if (!hasPositiveEv) {
      discardReasons.ev_too_low++;
      continue;
    }

    const hasAcceptableZone = allOutcomes.some(o => {
      const ev = calculateValuePercentage(o.fairProb, o.bestOdds);
      return isOddsAcceptable(o.bestOdds, ev, o.pinnacleAligns);
    });

    if (!hasAcceptableZone) {
      discardReasons.odds_out_of_zone++;
    }
  }

  const valueBetsCalculated = getSmartPicks(events, true);
  const passedThresholdFilters = valueBetsCalculated.filter(
    p => p.confidence === 'alta' || p.valuePercentage >= minAlertValue
  );

  // Contabilizar picks con EV positivo pero debajo del umbral de alerta
  const rejectedByThreshold = valueBetsCalculated.length - passedThresholdFilters.length;
  discardReasons.ev_too_low += Math.max(0, rejectedByThreshold);

  return {
    valueBetsCalculated,
    passedThresholdFilters,
    discardReasons,
  };
}

// ========== INTEGRACIÓN DE PROVEEDORES SECUNDARIOS CON DEGRADACIÓN ELEGANTE ==========

/**
 * Envuelve cualquier promesa con un timeout estricto (default 3000ms).
 * Si falla o expira, devuelve null sin propagar excepción.
 */
async function withGracefulTimeout<T>(promise: Promise<T>, ms: number = 3000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), ms);
    });
    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Enriquece asíncronamente los picks recomendados con estadísticas de SofaScore y BallDontLie.
 * Aislado con Degradación Elegante (Graceful Degradation) y timeout < 3s:
 * si SofaScore devuelve 403 Cloudflare o BallDontLie falla, el motor continúa
 * basándose puramente en el consenso matemático de mercado sin abortar el flujo.
 */
export async function enrichPicksWithStats(picks: SmartPick[]): Promise<SmartPick[]> {
  if (!picks || picks.length === 0) return [];

  const picksToEnrich = picks.slice(0, 10);

  const settled = await Promise.allSettled(
    picksToEnrich.map(async (pick) => {
      if (pick.confidence === 'alta' || pick.valuePercentage <= 0) {
        return pick;
      }

      try {
        const matchGana = pick.bestPick.match(/Gana (.+)/);
        if (!matchGana || !matchGana[1]) return pick;
        const teamName = matchGana[1].trim();

        // Si es NBA, intentar BallDontLie con timeout de 2.8s
        if (pick.sport.includes('basketball_nba')) {
          const nbaTeam = await withGracefulTimeout(searchNBATeam(teamName), 2800);
          if (nbaTeam) {
            const record = await withGracefulTimeout(getNBATeamRecord(nbaTeam.id), 2800);
            if (record && record.winPercentage >= 65) {
              return {
                ...pick,
                confidence: 'alta' as const,
                bestPick: `${pick.bestPick} 🔥`,
              };
            }
          }
        }

        // SofaScore form con timeout estricto de 2.8s
        const form = await withGracefulTimeout(getTeamForm(teamName), 2800);
        if (form && form.winPercentage >= 70) {
          return {
            ...pick,
            confidence: 'alta' as const,
            bestPick: `${pick.bestPick} 🔥`,
          };
        }
      } catch (err) {
        // Degradación elegante: nunca abortar la evaluación del partido
        console.warn(`[enrichPicksWithStats] Degradación elegante en ${pick.event}:`, err);
      }

      return pick;
    })
  );

  const enrichedPicks = settled.map((res, idx) =>
    res.status === 'fulfilled' ? res.value : picksToEnrich[idx]
  );

  return [...enrichedPicks, ...picks.slice(10)];
}

// ========== PICKS DIARIOS CON FILTRO DE CALIDAD ==========

export interface DailyPicksConfig {
  minPicks?: number;
  maxPicks?: number;
  requireHighConfidence?: boolean;
  todayOnly?: boolean;
}

function calculatePickScore(pick: SmartPick): number {
  const valueScore      = Math.min(pick.valuePercentage, 20) * 2;
  const consensusScore  = pick.consensusStrength * 20;
  const pinnacleBonus   = pick.pinnacleAligns ? 15 : 0;
  const steamBonus      = pick.isSteamMove ? 12 : 0;
  const confidenceBonus = pick.confidence === 'alta' ? 20
                        : pick.confidence === 'media' ? 10 : 0;
  const zoneBonus       = isOddsZoneA(pick.bestOdds) ? 5 : 0;
  return valueScore + consensusScore + pinnacleBonus + steamBonus + confidenceBonus + zoneBonus;
}

export function getTopDailyPicks(
  events: OddEvent[],
  config: DailyPicksConfig = {}
): SmartPick[] {
  const {
    minPicks = 1,
    maxPicks = 10,
    requireHighConfidence = false,
    todayOnly = true,
  } = config;

  const filteredEvents = todayOnly
    ? events.filter(e => isTodayInMexico(e.commence_time))
    : events;

  const allPicks = getSmartPicks(filteredEvents, true);

  const highQuality = allPicks.filter(p =>
    p.isRecommended && p.valuePercentage > 0 &&
    (requireHighConfidence
      ? p.confidence === 'alta'
      : p.confidence === 'alta' || p.confidence === 'media')
  );

  const lowQuality = allPicks.filter(p =>
    p.isRecommended && !highQuality.includes(p) && p.valuePercentage > 0
  );

  const sortedHigh = highQuality.sort((a, b) => calculatePickScore(b) - calculatePickScore(a));
  const sortedLow  = lowQuality.sort((a, b) => calculatePickScore(b) - calculatePickScore(a));

  let result = sortedHigh.slice(0, maxPicks);

  if (result.length < minPicks) {
    const needed = minPicks - result.length;
    result = [...result, ...sortedLow.slice(0, needed)];
  }

  return result;
}

// ========== ESTADÍSTICAS CUANTITATIVAS, CLV Y SIGNIFICANCIA ESTADÍSTICA (P-VALUE) ==========

/**
 * Aproximación numérica de la función de distribución acumulada normal estándar (1 - Phi(z))
 * para calcular el P-Value unilateral de ventaja estadística real sobre el azar (H0: ROI <= 0).
 */
function normalSurvivalFunction(z: number): number {
  if (z <= 0) return 0.5;
  if (z > 8) return 0.00001;
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const prob =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
  return Math.max(0, Math.min(1, prob));
}

export function calculateBettingStats(bets: Array<{
  status: string;
  stake: number;
  odds: number;
  profit: number;
  clv_pct?: number | null;
  closing_odds?: number | null;
}>) {
  const total = bets.length;
  const closed = bets.filter(b => b.status === 'won' || b.status === 'lost' || b.status === 'half_won' || b.status === 'half_lost');
  const won = bets.filter(b => b.status === 'won' || b.status === 'half_won');
  const lost = bets.filter(b => b.status === 'lost' || b.status === 'half_lost');
  const push = bets.filter(b => b.status === 'push' || b.status === 'void');
  const pending = bets.filter(b => b.status === 'pending');

  const totalStaked = closed.reduce((sum, b) => sum + (b.stake || 0), 0);
  const totalProfit = closed.reduce((sum, b) => sum + (b.profit || 0), 0);
  const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
  const winRate = closed.length > 0 ? (won.length / closed.length) * 100 : 0;

  // Cálculo de CLV promedio y EV esperado
  let clvSum = 0;
  let clvCount = 0;
  for (const b of bets) {
    if (typeof b.clv_pct === 'number' && !isNaN(b.clv_pct)) {
      clvSum += b.clv_pct;
      clvCount++;
    } else if (b.closing_odds && b.closing_odds > 1 && b.odds > 1) {
      const clv = ((b.odds / b.closing_odds) - 1) * 100;
      clvSum += clv;
      clvCount++;
    }
  }
  const avgClv = clvCount > 0 ? clvSum / clvCount : 0;

  // Significancia estadística (Test Z sobre rendimiento de apuestas cerradas)
  // Varianza por unidad apostada bajo H0 (sin ventaja): sigma^2 ≈ O - 1
  let zScore = 0;
  let pValue = 0.5;
  if (closed.length >= 3 && totalStaked > 0) {
    const avgOdds = closed.reduce((s, b) => s + (b.odds > 1 ? b.odds : 2), 0) / closed.length;
    const yieldDecimal = roi / 100;
    const stdDevPerBet = Math.sqrt(Math.max(0.25, avgOdds - 1));
    zScore = (yieldDecimal * Math.sqrt(closed.length)) / stdDevPerBet;
    pValue = normalSurvivalFunction(zScore);
  }

  return {
    total,
    won: won.length,
    lost: lost.length,
    push: push.length,
    pending: pending.length,
    totalStaked,
    totalProfit,
    roi,
    winRate,
    avgClv,
    clvCount,
    zScore,
    pValue,
    isStatisticallySignificant: pValue < 0.05 && closed.length >= 10,
  };
}
