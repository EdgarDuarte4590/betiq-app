'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

/**
 * Scores API response types from The Odds API
 */
interface ScoreEvent {
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

/**
 * Fetches completed scores from The Odds API for the last 3 days.
 * Costs 2 quota per sport (with daysFrom=3).
 * We only call for leagues where the user has pending bets.
 */
async function fetchScores(sportKey: string): Promise<ScoreEvent[]> {
  const API_KEY = process.env.THE_ODDS_API_KEY;
  if (!API_KEY) return [];

  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${API_KEY}&daysFrom=3`,
      { cache: 'no-store' } // Always fresh data for grading
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Normalizes team names for fuzzy matching.
 * Strips common suffixes, lowercases, removes accents.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+(fc|cf|sc|ac|as|ss|bc|club)$/i, '')
    .trim();
}

/**
 * Tries to match a bet's event string to an API score event.
 * The event field stored is usually "Team A vs Team B".
 */
function matchBetToScore(
  betEvent: string,
  betTime: string | null,
  scores: ScoreEvent[]
): ScoreEvent | null {
  const normBet = normalize(betEvent);
  
  for (const score of scores) {
    if (!score.completed || !score.scores) continue;
    
    // Enforce Date check: Solo hace match si la fecha del partido coincide con la que se guardó
    if (betTime) {
      const betDate = new Date(betTime).toISOString().split('T')[0];
      const scoreDate = new Date(score.commence_time).toISOString().split('T')[0];
      // Si el partido está guardado para hoy, ignora partidos de The Odds API que hayan sido ayer o mañana
      if (betDate !== scoreDate) {
        continue;
      }
    }
    
    const normHome = normalize(score.home_team);
    const normAway = normalize(score.away_team);
    
    // Check if both team names appear in the bet event string
    if (normBet.includes(normHome) && normBet.includes(normAway)) {
      return score;
    }
    
    // Also check "away vs home" format
    const combined1 = `${normHome} vs ${normAway}`;
    const combined2 = `${normAway} vs ${normHome}`;
    if (normBet === combined1 || normBet === combined2) {
      return score;
    }
  }
  
  return null;
}

/**
 * Determines if the user's pick won based on scores.
 * For H2H market, we check which team scored higher.
 * For Draw, we check if it's a tie.
 */
function didPickWin(
  pick: string,
  score: ScoreEvent,
  market: string
): boolean | null {
  if (!score.scores || score.scores.length < 2) return null;

  const homeScore = parseInt(score.scores[0].score);
  const awScore = parseInt(score.scores[1].score);
  
  if (isNaN(homeScore) || isNaN(awScore)) return null;
  const totalScore = homeScore + awScore;
  
  const normPick = normalize(pick);
  const normHome = normalize(score.home_team);
  const normAway = normalize(score.away_team);

  // ── Totals / Over/Under ── (handles 'Over 2.5', 'Under 9.5', 'Goles +1.5', 'Carreras +8.5')
  // Check market name first, then pick label
  const isOverUnderMarket = /over.?under|totals|goles\s*[+\-]|carreras\s*[+\-]|puntos\s*[+\-]/i.test(market);
  const isOverPick  = /(^|\s)(over|mas|más|\+)/i.test(pick);
  const isUnderPick = /(^|\s)(under|menos)/i.test(pick);
  
  if (isOverUnderMarket || isOverPick || isUnderPick) {
    const numMatch = pick.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (numMatch) {
      const line = parseFloat(numMatch[1]);
      if (isOverPick) return totalScore > line;
      if (isUnderPick) return totalScore < line;
      // If market says totals but pick label unclear, check if "over" is anywhere in pick
      if (isOverUnderMarket) {
        if (/over|más|\+/i.test(pick)) return totalScore > line;
        if (/under|menos/i.test(pick)) return totalScore < line;
      }
    }
    return null; // can't determine without a line
  }

  // ── H2H / Ganador bets ──
  if (market === 'H2H' || market === 'Ganador' || !market || normPick.includes('gana')) {
    if (normPick.includes(normHome) || normHome.includes(normPick.replace('gana ', '').trim())) {
      return homeScore > awScore;
    }
    if (normPick.includes(normAway) || normAway.includes(normPick.replace('gana ', '').trim())) {
      return awScore > homeScore;
    }
  }
  
  // ── Draw / Empate ──
  if (market === 'Empate' || normPick === 'draw' || normPick === 'empate') {
    return homeScore === awScore;
  }

  return null;
}

/**
 * syncScores - The Auto-Grader Server Action
 * 
 * 1. Fetches all pending bets for the current user
 * 2. Groups them by sport to minimize API calls
 * 3. Fetches scores for relevant sports
 * 4. Matches and grades each bet
 * 5. Updates bankroll accordingly
 */
export async function syncScores(): Promise<{
  success: boolean;
  graded: number;
  won: number;
  lost: number;
  skipped: number;
  error?: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, graded: 0, won: 0, lost: 0, skipped: 0, error: 'No autenticado' };

  // 1. Get all pending bets
  const { data: pendingBets, error: betsError } = await supabase
    .from('bets')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  if (betsError) return { success: false, graded: 0, won: 0, lost: 0, skipped: 0, error: betsError.message };
  if (!pendingBets || pendingBets.length === 0) {
    return { success: true, graded: 0, won: 0, lost: 0, skipped: 0 };
  }

  // 2. Map sport names from our DB to API sport keys
  // Dinámico: si el bet ya tiene un sport_key válido de la API, lo usamos directamente.
  // Solo usamos fallbacks para emojis o valores genéricos.
  const sportKeyMap: Record<string, string> = {
    // Temporada actual — Mundial 2026
    'soccer_fifa_world_cup': 'soccer_fifa_world_cup',
    // Ligas activas
    'basketball_nba': 'basketball_nba',
    'baseball_mlb': 'baseball_mlb',
    // Legado — ligas europeas (para grading de bets viejas que quedaron pendientes)
    'soccer_epl': 'soccer_epl',
    'soccer_spain_la_liga': 'soccer_spain_la_liga',
    'soccer_uefa_champs_league': 'soccer_uefa_champs_league',
    'soccer_france_ligue_one': 'soccer_france_ligue_one',
    'soccer_italy_serie_a': 'soccer_italy_serie_a',
    'soccer_germany_bundesliga': 'soccer_germany_bundesliga',
    // Generic emoji fallbacks
    '⚽': 'soccer_fifa_world_cup',
    '🏆': 'soccer_fifa_world_cup',
    '🏀': 'basketball_nba',
    '⚾': 'baseball_mlb',
  };

  // Collect unique sport keys from pending bets
  const sportKeys = new Set<string>();
  for (const bet of pendingBets) {
    const key = sportKeyMap[bet.sport] || bet.sport;
    // Si el key es un sport_key válido de la API, úsalo directamente
    if (key.includes('soccer') || key.includes('⚽') || key.includes('🏆')) {
      // Usar el key específico si existe en el mapa, si no el genérico del Mundial
      sportKeys.add(sportKeyMap[bet.sport] || 'soccer_fifa_world_cup');
    } else if (key.includes('basketball') || key.includes('🏀')) {
      sportKeys.add('basketball_nba');
    } else if (key.includes('baseball') || key.includes('⚾')) {
      sportKeys.add('baseball_mlb');
    } else {
      // Default: fetch las ligas activas actuales
      sportKeys.add('soccer_fifa_world_cup');
      sportKeys.add('basketball_nba');
      sportKeys.add('baseball_mlb');
    }
  }

  // 3. Fetch scores from API for each sport (parallelized)
  const allScores: ScoreEvent[] = [];
  const scorePromises = Array.from(sportKeys).map(async (sportKey) => {
    const scores = await fetchScores(sportKey);
    return scores;
  });
  const results = await Promise.all(scorePromises);
  results.forEach(r => allScores.push(...r));

  // 4. Grade each pending bet
  let graded = 0;
  let won = 0;
  let lost = 0;
  let skipped = 0;

  // Get current bankroll
  const { data: profile } = await supabase
    .from('profiles')
    .select('bankroll_actual')
    .eq('id', user.id)
    .single();

  let currentBankroll = parseFloat(profile?.bankroll_actual ?? '1000');

  for (const bet of pendingBets) {
    // bet.match_time might be missing in old accounts, so we pass it safely
    const matchedScore = matchBetToScore(bet.event, bet.match_time ?? null, allScores);
    
    if (!matchedScore) {
      skipped++;
      continue;
    }

    const result = didPickWin(bet.pick, matchedScore, bet.market);
    
    if (result === null) {
      skipped++;
      continue;
    }

    const stake = parseFloat(bet.stake);
    const odds = parseFloat(bet.odds);
    const status = result ? 'won' : 'lost';
    const profit = result
      ? parseFloat(((stake * odds) - stake).toFixed(2))
      : -stake;

    // Update bet in DB
    await supabase
      .from('bets')
      .update({ status, profit })
      .eq('id', bet.id)
      .eq('user_id', user.id);

    // Update bankroll
    if (result) {
      currentBankroll += stake + Math.abs(profit); // Return stake + winnings
      won++;
    }
    // If lost, stake was already deducted when bet was placed
    else {
      lost++;
    }

    graded++;
  }

  // 5. Save final bankroll
  if (graded > 0) {
    await supabase
      .from('profiles')
      .update({ bankroll_actual: currentBankroll })
      .eq('id', user.id);

    revalidatePath('/picks');
    revalidatePath('/dashboard');
    revalidatePath('/bankroll');
  }

  return { success: true, graded, won, lost, skipped };
}

/**
 * Global Auto-Grader for Cron Jobs
 * Uses Admin Client to grade all pending bets for all users.
 */
export async function syncAllPendingBets(): Promise<{
  success: boolean;
  graded: number;
  won: number;
  lost: number;
  skipped: number;
  error?: string;
}> {
  const supabase = createAdminClient();

  // 1. Get ALL pending bets
  const { data: pendingBets, error: betsError } = await supabase
    .from('bets')
    .select('*')
    .eq('status', 'pending');

  if (betsError) return { success: false, graded: 0, won: 0, lost: 0, skipped: 0, error: betsError.message };
  if (!pendingBets || pendingBets.length === 0) {
    return { success: true, graded: 0, won: 0, lost: 0, skipped: 0 };
  }

  const sportKeyMap: Record<string, string> = {
    'soccer_fifa_world_cup': 'soccer_fifa_world_cup',
    'basketball_nba': 'basketball_nba',
    'baseball_mlb': 'baseball_mlb',
    'soccer_epl': 'soccer_epl',
    'soccer_spain_la_liga': 'soccer_spain_la_liga',
    'soccer_uefa_champs_league': 'soccer_uefa_champs_league',
    'soccer_france_ligue_one': 'soccer_france_ligue_one',
    'soccer_italy_serie_a': 'soccer_italy_serie_a',
    'soccer_germany_bundesliga': 'soccer_germany_bundesliga',
    '⚽': 'soccer_fifa_world_cup',
    '🏆': 'soccer_fifa_world_cup',
    '🏀': 'basketball_nba',
    '⚾': 'baseball_mlb',
  };

  const sportKeys = new Set<string>();
  for (const bet of pendingBets) {
    const key = sportKeyMap[bet.sport] || bet.sport;
    if (key.includes('soccer') || key.includes('⚽') || key.includes('🏆')) {
      sportKeys.add(sportKeyMap[bet.sport] || 'soccer_fifa_world_cup');
    } else if (key.includes('basketball') || key.includes('🏀')) {
      sportKeys.add('basketball_nba');
    } else if (key.includes('baseball') || key.includes('⚾')) {
      sportKeys.add('baseball_mlb');
    } else {
      sportKeys.add('soccer_fifa_world_cup');
      sportKeys.add('basketball_nba');
      sportKeys.add('baseball_mlb');
    }
  }

  const allScores: ScoreEvent[] = [];
  const scorePromises = Array.from(sportKeys).map(async (sportKey) => {
    return await fetchScores(sportKey);
  });
  const results = await Promise.all(scorePromises);
  results.forEach(r => allScores.push(...r));

  let graded = 0;
  let won = 0;
  let lost = 0;
  let skipped = 0;

  // We need to group by user to update bankrolls efficiently
  const userBankrollUpdates: Record<string, number> = {};

  for (const bet of pendingBets) {
    const matchedScore = matchBetToScore(bet.event, bet.match_time ?? null, allScores);
    if (!matchedScore) { skipped++; continue; }

    const result = didPickWin(bet.pick, matchedScore, bet.market);
    if (result === null) { skipped++; continue; }

    const stake = parseFloat(bet.stake);
    const odds = parseFloat(bet.odds);
    const status = result ? 'won' : 'lost';
    const profit = result ? parseFloat(((stake * odds) - stake).toFixed(2)) : -stake;

    await supabase.from('bets').update({ status, profit }).eq('id', bet.id);

    if (result) {
      userBankrollUpdates[bet.user_id] = (userBankrollUpdates[bet.user_id] || 0) + stake + Math.abs(profit);
      won++;
    } else {
      lost++;
    }
    graded++;
  }

  // Update bankrolls
  for (const [userId, amountToAdd] of Object.entries(userBankrollUpdates)) {
    if (amountToAdd > 0) {
      const { data: profile } = await supabase.from('profiles').select('bankroll_actual').eq('id', userId).single();
      if (profile) {
        await supabase.from('profiles').update({ 
          bankroll_actual: parseFloat(profile.bankroll_actual) + amountToAdd 
        }).eq('id', userId);
      }
    }
  }

  return { success: true, graded, won, lost, skipped };
}
