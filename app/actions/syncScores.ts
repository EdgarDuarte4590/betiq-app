'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { getActiveKey, recordKeyUsage, markKeyExhausted } from '@/lib/apis/key-manager';
import {
  resolveScoreEvent,
  calculateEntitySimilarity,
  normalizeTeamEntity,
} from '@/lib/apis/entity-resolver';
import { SPORT_SCHEDULE } from '@/lib/apis/odds-api';

/**
 * Scores API response types from The Odds API
 */
export interface ScoreEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
}

export type BetGradeOutcome = 'won' | 'lost' | 'push' | 'void' | 'half_won' | 'half_lost';

/**
 * Fetches completed scores from The Odds API for the last 3 days.
 * Con rotación automática de llaves ante 401/402/429.
 */
async function fetchScores(sportKey: string, excludedKeys: Set<string> = new Set()): Promise<ScoreEvent[]> {
  const API_KEY = await getActiveKey(excludedKeys);
  if (!API_KEY) {
    console.error('[syncScores] No hay API keys disponibles para fetchScores');
    return [];
  }

  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${API_KEY}&daysFrom=3`,
      { cache: 'no-store' }
    );

    await recordKeyUsage(API_KEY, res.headers);

    if (!res.ok) {
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        await markKeyExhausted(API_KEY, res.status);
        excludedKeys.add(API_KEY);
        const nextKey = await getActiveKey(excludedKeys);
        if (nextKey) {
          return fetchScores(sportKey, excludedKeys);
        }
      }
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Empareja el evento de una apuesta con un partido finalizado usando
 * `entity-resolver.ts` (Jaro-Winkler / Dice >= 0.85 + ventana horaria ±2h).
 */
function matchBetToScore(
  betEvent: string,
  betTime: string | null,
  scores: ScoreEvent[]
): ScoreEvent | null {
  return resolveScoreEvent(betEvent, betTime, scores, 0.85);
}

/**
 * Extrae los goles/puntos de local y visitante verificando el nombre de cada equipo en `score.scores`.
 */
function extractHomeAwayScores(score: ScoreEvent): { homeScore: number; awayScore: number } | null {
  if (!score.scores || score.scores.length < 2) return null;

  let homeEntry = score.scores.find(s => calculateEntitySimilarity(s.name, score.home_team) >= 0.85);
  let awayEntry = score.scores.find(s => calculateEntitySimilarity(s.name, score.away_team) >= 0.85);

  if (!homeEntry || !awayEntry) {
    homeEntry = score.scores[0];
    awayEntry = score.scores[1];
  }

  const homeScore = parseInt(homeEntry.score, 10);
  const awayScore = parseInt(awayEntry.score, 10);

  if (isNaN(homeScore) || isNaN(awayScore)) return null;
  return { homeScore, awayScore };
}

/**
 * Determina el resultado exacto de la apuesta soportando:
 * - 'won', 'lost', 'push', 'void', 'half_won', 'half_lost'
 */
function gradePickOutcome(
  pick: string,
  score: ScoreEvent,
  market: string
): BetGradeOutcome | null {
  const parsed = extractHomeAwayScores(score);
  if (!parsed) return null;

  const { homeScore, awayScore } = parsed;
  const totalScore = homeScore + awayScore;

  const cleanPick = pick.replace(/🔥/g, '').trim();
  const normPick = normalizeTeamEntity(cleanPick);

  // ── 1. Totals / Over/Under (con soporte de líneas enteras -> PUSH y asiáticas .25/.75) ──
  const isOverUnderMarket = /over.?under|totals|goles\s*[+\-]|carreras\s*[+\-]|puntos\s*[+\-]/i.test(market || '');
  const isOverPick  = /(^|\s)(over|mas|más|\+)/i.test(cleanPick);
  const isUnderPick = /(^|\s)(under|menos)/i.test(cleanPick);

  if (isOverUnderMarket || isOverPick || isUnderPick) {
    const numMatch = cleanPick.match(/([0-9]+(?:\.[0-9]+)?)/) || (market || '').match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!numMatch) return null;

    const line = parseFloat(numMatch[1]);
    if (isNaN(line)) return null;

    const isOver = isOverPick || (isOverUnderMarket && /over|más|\+/i.test(cleanPick || market));
    const isUnder = isUnderPick || (isOverUnderMarket && /under|menos|-/i.test(cleanPick || market));

    if (!isOver && !isUnder) return null;

    const diff = isOver ? totalScore - line : line - totalScore;
    if (Math.abs(diff) < 1e-6) return 'push'; // Línea exacta (ej. Over 2.0 y hubo 2 goles)
    if (Math.abs(diff - 0.25) < 1e-6) return 'half_won';
    if (Math.abs(diff + 0.25) < 1e-6) return 'half_lost';
    return diff > 0 ? 'won' : 'lost';
  }

  // ── 2. Draw / Empate ──
  if (market === 'Empate' || normPick === 'draw' || normPick === 'empate') {
    return homeScore === awayScore ? 'won' : 'lost';
  }

  // ── 3. H2H / Ganador (con Entity Resolution Jaro-Winkler / Dice >= 0.85) ──
  if (market === 'H2H' || market === 'Ganador' || !market || /^gana\s+/i.test(cleanPick)) {
    const teamCandidate = cleanPick.replace(/^gana\s+/i, '').trim();
    const simHome = calculateEntitySimilarity(teamCandidate, score.home_team);
    const simAway = calculateEntitySimilarity(teamCandidate, score.away_team);

    if (simHome >= 0.85 && simHome >= simAway) {
      return homeScore > awayScore ? 'won' : 'lost';
    }
    if (simAway >= 0.85 && simAway > simHome) {
      return awayScore > homeScore ? 'won' : 'lost';
    }
  }

  return null;
}

/**
 * Calcula el profit neto y el monto a retornar al bankroll según el estado de liquidación
 * (recordando que el `stake` ya se descontó cuando la apuesta quedó en `pending`).
 */
function calculateSettlementAccounting(
  outcome: BetGradeOutcome,
  stake: number,
  odds: number
): {
  profit: number;
  bankrollCredit: number; // Cuánto sumar a bankroll_actual al liquidar desde PENDING
} {
  const netWin = (stake * odds) - stake;

  switch (outcome) {
    case 'won':
      return {
        profit: Number(netWin.toFixed(2)),
        bankrollCredit: Number((stake + netWin).toFixed(2)),
      };
    case 'half_won': {
      const halfProfit = netWin / 2;
      return {
        profit: Number(halfProfit.toFixed(2)),
        bankrollCredit: Number((stake + halfProfit).toFixed(2)),
      };
    }
    case 'push':
    case 'void':
      return {
        profit: 0,
        bankrollCredit: Number(stake.toFixed(2)), // Devolver el stake íntegro
      };
    case 'half_lost': {
      const halfLoss = -(stake / 2);
      return {
        profit: Number(halfLoss.toFixed(2)),
        bankrollCredit: Number((stake / 2).toFixed(2)), // Devolver mitad del stake
      };
    }
    case 'lost':
    default:
      return {
        profit: Number((-stake).toFixed(2)),
        bankrollCredit: 0, // El stake ya fue descontado al crear la apuesta
      };
  }
}

/**
 * Resuelve las ligas de The Odds API que se deben consultar según las apuestas pendientes.
 */
function resolveSportKeysForPendingBets(pendingBets: any[]): Set<string> {
  const validScheduleKeys = new Set(SPORT_SCHEDULE.map(s => s.key));
  const sportKeys = new Set<string>();

  for (const bet of pendingBets) {
    const rawSport = String(bet.sport || '').trim();
    if (validScheduleKeys.has(rawSport) || rawSport.includes('_')) {
      sportKeys.add(rawSport);
    } else if (rawSport.includes('🏀') || rawSport.toLowerCase().includes('basketball')) {
      sportKeys.add('basketball_nba');
    } else if (rawSport.includes('⚾') || rawSport.toLowerCase().includes('baseball')) {
      sportKeys.add('baseball_mlb');
    } else {
      // Si es el ícono genérico ⚽, incluir las ligas de fútbol principales
      sportKeys.add('soccer_usa_mls');
      sportKeys.add('soccer_mexico_ligamx');
      sportKeys.add('soccer_brazil_campeonato');
      sportKeys.add('soccer_argentina_primera_division');
      sportKeys.add('soccer_epl');
      sportKeys.add('soccer_spain_la_liga');
      sportKeys.add('soccer_italy_serie_a');
      sportKeys.add('soccer_germany_bundesliga');
      sportKeys.add('soccer_france_ligue_one');
      sportKeys.add('soccer_uefa_champs_league');
    }
  }

  return sportKeys;
}

/**
 * syncScores - Auto-Grader Server Action para el usuario autenticado.
 * Implementa el patrón Libro Mayor Inmutable (Ledger Idempotency):
 * verifica atómicamente `WHERE id = X AND status = 'pending'` antes de acreditar el bankroll.
 */
export async function syncScores(): Promise<{
  success: boolean;
  graded: number;
  won: number;
  lost: number;
  pushed?: number;
  skipped: number;
  error?: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, graded: 0, won: 0, lost: 0, skipped: 0, error: 'No autenticado' };

  const adminSupabase = createAdminClient();

  const { data: pendingBets, error: betsError } = await adminSupabase
    .from('bets')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  if (betsError) return { success: false, graded: 0, won: 0, lost: 0, skipped: 0, error: betsError.message };
  if (!pendingBets || pendingBets.length === 0) {
    return { success: true, graded: 0, won: 0, lost: 0, pushed: 0, skipped: 0 };
  }

  const sportKeys = resolveSportKeysForPendingBets(pendingBets);
  const allScores: ScoreEvent[] = [];
  const results = await Promise.all(Array.from(sportKeys).map(sk => fetchScores(sk)));
  results.forEach(r => allScores.push(...r));

  let graded = 0;
  let won = 0;
  let lost = 0;
  let pushed = 0;
  let skipped = 0;
  let totalBankrollCredit = 0;

  for (const bet of pendingBets) {
    const matchedScore = matchBetToScore(bet.event, bet.match_time ?? null, allScores);
    if (!matchedScore) {
      skipped++;
      continue;
    }

    const outcome = gradePickOutcome(bet.pick, matchedScore, bet.market);
    if (outcome === null) {
      skipped++;
      continue;
    }

    const stake = parseFloat(bet.stake);
    const odds = parseFloat(bet.odds);
    const { profit, bankrollCredit } = calculateSettlementAccounting(outcome, stake, odds);

    // Transición atómica idempotente: SOLO actualiza si sigue en estado 'pending'
    const { data: updatedRows, error: updateErr } = await adminSupabase
      .from('bets')
      .update({ status: outcome, profit })
      .eq('id', bet.id)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .select('id');

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      // Otra ejecución concurrente ya liquidó esta apuesta → no acreditar dos veces
      continue;
    }

    totalBankrollCredit += bankrollCredit;
    if (outcome === 'won' || outcome === 'half_won') won++;
    else if (outcome === 'push' || outcome === 'void') pushed++;
    else lost++;

    graded++;
  }

  if (graded > 0) {
    if (totalBankrollCredit > 0) {
      const { data: profile } = await adminSupabase
        .from('profiles')
        .select('bankroll_actual')
        .eq('id', user.id)
        .single();

      const currentBankroll = parseFloat(profile?.bankroll_actual ?? '1000');
      const nextBankroll = Number((currentBankroll + totalBankrollCredit).toFixed(2));

      await adminSupabase
        .from('profiles')
        .update({ bankroll_actual: nextBankroll })
        .eq('id', user.id);
    }

    revalidatePath('/picks');
    revalidatePath('/dashboard');
    revalidatePath('/bankroll');
    revalidatePath('/trends');
  }

  return { success: true, graded, won, lost, pushed, skipped };
}

/**
 * Global Auto-Grader para Cron Jobs (`/api/cron/sync-scores`).
 * Usa exclusivamente `createAdminClient()` y liquidación atómica idempotente.
 */
export async function syncAllPendingBets(): Promise<{
  success: boolean;
  graded: number;
  won: number;
  lost: number;
  pushed?: number;
  skipped: number;
  error?: string;
}> {
  const supabase = createAdminClient();

  const { data: pendingBets, error: betsError } = await supabase
    .from('bets')
    .select('*')
    .eq('status', 'pending');

  if (betsError) return { success: false, graded: 0, won: 0, lost: 0, skipped: 0, error: betsError.message };
  if (!pendingBets || pendingBets.length === 0) {
    return { success: true, graded: 0, won: 0, lost: 0, pushed: 0, skipped: 0 };
  }

  const sportKeys = resolveSportKeysForPendingBets(pendingBets);
  const allScores: ScoreEvent[] = [];
  const results = await Promise.all(Array.from(sportKeys).map(sk => fetchScores(sk)));
  results.forEach(r => allScores.push(...r));

  let graded = 0;
  let won = 0;
  let lost = 0;
  let pushed = 0;
  let skipped = 0;

  const userBankrollCredits: Record<string, number> = {};

  for (const bet of pendingBets) {
    const matchedScore = matchBetToScore(bet.event, bet.match_time ?? null, allScores);
    if (!matchedScore) {
      skipped++;
      continue;
    }

    const outcome = gradePickOutcome(bet.pick, matchedScore, bet.market);
    if (outcome === null) {
      skipped++;
      continue;
    }

    const stake = parseFloat(bet.stake);
    const odds = parseFloat(bet.odds);
    const { profit, bankrollCredit } = calculateSettlementAccounting(outcome, stake, odds);

    // Liquidación atómica idempotente: solo procede si la fila estaba en 'pending'
    const { data: updatedRows, error: updateErr } = await supabase
      .from('bets')
      .update({ status: outcome, profit })
      .eq('id', bet.id)
      .eq('status', 'pending')
      .select('id');

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      continue;
    }

    if (bankrollCredit > 0) {
      userBankrollCredits[bet.user_id] = (userBankrollCredits[bet.user_id] || 0) + bankrollCredit;
    }

    if (outcome === 'won' || outcome === 'half_won') won++;
    else if (outcome === 'push' || outcome === 'void') pushed++;
    else lost++;

    graded++;
  }

  for (const [userId, amountToAdd] of Object.entries(userBankrollCredits)) {
    if (amountToAdd > 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('bankroll_actual')
        .eq('id', userId)
        .single();

      if (profile) {
        const updatedBalance = Number((parseFloat(profile.bankroll_actual) + amountToAdd).toFixed(2));
        await supabase
          .from('profiles')
          .update({ bankroll_actual: updatedBalance })
          .eq('id', userId);
      }
    }
  }

  return { success: true, graded, won, lost, pushed, skipped };
}
