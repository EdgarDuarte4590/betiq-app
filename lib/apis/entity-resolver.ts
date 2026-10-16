/**
 * BetIQ Entity Resolution Layer v4.0 (`lib/apis/entity-resolver.ts`)
 *
 * Resuelve discrepancias de nombres de equipos y partidos entre múltiples proveedores
 * (`odds-api.ts`, `sofascore.ts`, `balldontlie.ts` y registros históricos en Supabase):
 * - Normalización canónica (minúsculas, eliminación de diacríticos, expansión de alias,
 *   limpieza de prefijos/sufijos como FC, CF, SC, AC, CD, Club, Deportivo)
 * - Similitud híbrida Jaro-Winkler + Sørensen-Dice Coefficient (umbral >= 0.85)
 * - Validación de ventana horaria (±2 horas del `commence_time` o mismo día de juego)
 */

// Diccionario de alias frecuentes entre casas y proveedores de datos
const CANONICAL_ALIASES: Record<string, string> = {
  'man united': 'manchester united',
  'man utd': 'manchester united',
  'manchester utd': 'manchester united',
  'man city': 'manchester city',
  'spurs': 'tottenham hotspur',
  'tottenham': 'tottenham hotspur',
  'wolves': 'wolverhampton wanderers',
  'wolverhampton': 'wolverhampton wanderers',
  'brighton': 'brighton and hove albion',
  'newcastle': 'newcastle united',
  'west ham': 'west ham united',
  'nottm forest': 'nottingham forest',
  'psg': 'paris saint germain',
  'paris sg': 'paris saint germain',
  'inter': 'inter milan',
  'internazionale': 'inter milan',
  'atleti': 'atletico madrid',
  'atletico': 'atletico madrid',
  'athletic bilbao': 'athletic club',
  'betis': 'real betis',
  'sociedad': 'real sociedad',
  'bayern': 'bayern munich',
  'bayern munchen': 'bayern munich',
  'leverkusen': 'bayer leverkusen',
  'dortmund': 'borussia dortmund',
  'gladbach': 'borussia monchengladbach',
  'mgladbach': 'borussia monchengladbach',
  'ny red bulls': 'new york red bulls',
  'nycfc': 'new york city',
  'new york city fc': 'new york city',
  'inter miami cf': 'inter miami',
  'la galaxy': 'los angeles galaxy',
  'lafc': 'los angeles',
  'st louis city': 'st louis',
};

/**
 * Normaliza una cadena de nombre de equipo:
 * 1. Minúsculas y sin acentos/diacríticos
 * 2. Reemplazo de puntuación por espacios
 * 3. Eliminación de tokens genéricos (FC, CF, SC, AC, AS, SS, BC, CD, UD, Club, Deportivo)
 * 4. Resolución en diccionario de alias canónicos
 */
export function normalizeTeamEntity(rawName: string): string {
  if (!rawName) return '';

  let cleaned = rawName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[.'’"&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (CANONICAL_ALIASES[cleaned]) {
    return CANONICAL_ALIASES[cleaned];
  }

  // Eliminar prefijos y sufijos institucionales comunes
  const stopTokens = new Set([
    'fc', 'cf', 'sc', 'ac', 'as', 'ss', 'bc', 'cd', 'ud', 'rc', 'rcd',
    'club', 'deportivo', 'atletico', 'sporting', 'real', 'ca', 'se', 'cr',
  ]);

  const tokens = cleaned.split(' ').filter(Boolean);
  const filteredTokens = tokens.filter(t => !stopTokens.has(t));

  // Si al quitar tokens genéricos nos quedamos sin nada (ej. "Real"), conservar el original limpio
  const result = (filteredTokens.length > 0 ? filteredTokens : tokens).join(' ');

  // Estandarizar abreviaturas comunes dentro del nombre
  const standardized = result
    .replace(/\butd\b/g, 'united')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bny\b/g, 'new york')
    .replace(/\bla\b/g, 'los angeles')
    .trim();

  return CANONICAL_ALIASES[standardized] ?? standardized;
}

/**
 * Calcula el coeficiente de similitud Sørensen-Dice basado en bigramas [0, 1].
 */
export function diceCoefficient(a: string, b: string): number {
  const s1 = a.replace(/\s+/g, '');
  const s2 = b.replace(/\s+/g, '');
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.slice(i, i + 2);
    bigrams1.set(bg, (bigrams1.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.slice(i, i + 2);
    const count = bigrams1.get(bg) ?? 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (s1.length - 1 + (s2.length - 1));
}

/**
 * Calcula la similitud Jaro-Winkler [0, 1] entre dos cadenas normalizadas.
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }

  const transpositions = t / 2;
  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;

  // Prefijo común hasta 4 caracteres para el ajuste Winkler
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(len1, len2));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Calcula la similitud de entidad entre dos nombres de equipos.
 * Retorna un valor en [0, 1].
 */
export function calculateEntitySimilarity(nameA: string, nameB: string): number {
  const normA = normalizeTeamEntity(nameA);
  const normB = normalizeTeamEntity(nameB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // Si uno contiene completamente al otro (ej. "arsenal" en "arsenal london") y tiene >= 4 letras
  if (
    (normA.length >= 4 && normB.includes(normA)) ||
    (normB.length >= 4 && normA.includes(normB))
  ) {
    return Math.max(0.90, jaroWinklerSimilarity(normA, normB));
  }

  const jw = jaroWinklerSimilarity(normA, normB);
  const dice = diceCoefficient(normA, normB);
  return Math.max(jw, dice);
}

/**
 * Verifica si dos marcas de tiempo están dentro de la ventana horaria permitida
 * (±2 horas por defecto, o mismo día calendario si una de las fechas no tenía hora exacta).
 */
export function isWithinTimeWindow(
  betTimeIso: string | null | undefined,
  eventCommenceIso: string | null | undefined,
  toleranceHours: number = 2
): boolean {
  if (!betTimeIso || !eventCommenceIso) return true; // Si la apuesta antigua no guardó match_time, no bloquear

  const t1 = new Date(betTimeIso).getTime();
  const t2 = new Date(eventCommenceIso).getTime();
  if (isNaN(t1) || isNaN(t2)) return true;

  const diffHours = Math.abs(t1 - t2) / (1000 * 60 * 60);
  if (diffHours <= toleranceHours) return true;

  // Fallback tolerante a cambios de horario de partido en el mismo día (±14h)
  const date1 = new Date(betTimeIso).toISOString().split('T')[0];
  const date2 = new Date(eventCommenceIso).toISOString().split('T')[0];
  return date1 === date2 || diffHours <= 14;
}

/**
 * Extrae `home` y `away` de una etiqueta de evento tipo "Team A vs Team B".
 */
export function splitEventTeams(eventString: string): [string, string] | null {
  const parts = eventString.split(/\s+vs\.?\s+|\s+v\s+|\s+-\s+/i);
  if (parts.length >= 2) {
    return [parts[0].trim(), parts.slice(1).join(' ').trim()];
  }
  return null;
}

/**
 * Empareja el nombre de un evento de apuesta ("Home vs Away") contra una lista de
 * eventos de resultados usando similitud Jaro-Winkler / Dice >= 0.85 y ventana horaria.
 */
export function resolveScoreEvent<T extends {
  home_team: string;
  away_team: string;
  commence_time: string;
  completed?: boolean;
  scores?: any;
}>(
  betEvent: string,
  betTime: string | null | undefined,
  candidates: T[],
  similarityThreshold: number = 0.85
): T | null {
  const split = splitEventTeams(betEvent);
  let bestCandidate: T | null = null;
  let bestScore = 0;

  for (const cand of candidates) {
    if (cand.completed === false || !cand.scores) continue;
    if (!isWithinTimeWindow(betTime, cand.commence_time, 2)) continue;

    if (split) {
      const [betHome, betAway] = split;

      // Orientación directa (Home vs Away)
      const simHomeDirect = calculateEntitySimilarity(betHome, cand.home_team);
      const simAwayDirect = calculateEntitySimilarity(betAway, cand.away_team);
      const avgDirect = (simHomeDirect + simAwayDirect) / 2;

      // Orientación invertida (Away vs Home)
      const simHomeSwap = calculateEntitySimilarity(betHome, cand.away_team);
      const simAwaySwap = calculateEntitySimilarity(betAway, cand.home_team);
      const avgSwap = (simHomeSwap + simAwaySwap) / 2;

      const pairSim = Math.max(avgDirect, avgSwap);
      const minSideSim =
        avgDirect >= avgSwap
          ? Math.min(simHomeDirect, simAwayDirect)
          : Math.min(simHomeSwap, simAwaySwap);

      // Ambos equipos deben tener buena similitud y el promedio >= 0.85
      if (pairSim >= similarityThreshold && minSideSim >= 0.75 && pairSim > bestScore) {
        bestScore = pairSim;
        bestCandidate = cand;
      }
    } else {
      // Si el evento no tenía separador "vs", comparar la cadena completa
      const fullCand = `${cand.home_team} vs ${cand.away_team}`;
      const sim = calculateEntitySimilarity(betEvent, fullCand);
      if (sim >= similarityThreshold && sim > bestScore) {
        bestScore = sim;
        bestCandidate = cand;
      }
    }
  }

  return bestCandidate;
}
