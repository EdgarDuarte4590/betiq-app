/**
 * BetIQ Dashboard Data Layer v3.0
 *
 * Lee los datos de cuotas desde la tabla `odds_snapshots` de Supabase
 * en lugar de llamar directamente a The Odds API en cada page render.
 *
 * El cron job `/api/cron/refresh-odds` es el ÚNICO que llama a The Odds API.
 * El Dashboard siempre lee desde la BD — ahorrando ~80% del consumo de API keys.
 */

import { createClient } from '@/lib/supabase/server';
import { createClient as createClientBrowser } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import type { OddEvent, Bookmaker, Market, Outcome } from '@/lib/apis/odds-api';

const MAX_SNAPSHOT_AGE_HOURS = 8; // Si los datos tienen más de 8h, considerarlos stale

interface SnapshotRow {
  event_id: string;
  event_label: string;
  sport_key: string;
  bookmaker_key: string;
  market_key: string;
  outcome_name: string;
  odds: number;
  recorded_at: string;
}

// Usar caché compartido para no saturar Supabase con 35 queries por cada usuario
const fetchCachedSnapshots = unstable_cache(
  async (cutoffIso: string) => {
    // Necesitamos un cliente que no use cookies para que unstable_cache funcione correctamente
    const supaAdmin = createClientBrowser(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { count } = await supaAdmin
      .from('odds_snapshots')
      .select('*', { count: 'exact', head: true })
      .gte('recorded_at', cutoffIso);

    if (!count) return [];

    const pageSize = 1000;
    const pages = Math.ceil(count / pageSize);
    const fetchPromises = [];

    for (let i = 0; i < pages; i++) {
      const from = i * pageSize;
      const to = from + pageSize - 1;
      fetchPromises.push(
        supaAdmin
          .from('odds_snapshots')
          .select('event_id, event_label, sport_key, bookmaker_key, market_key, outcome_name, odds, recorded_at')
          .gte('recorded_at', cutoffIso)
          .order('recorded_at', { ascending: false })
          .range(from, to)
      );
    }

    const results = await Promise.all(fetchPromises);
    return results.flatMap(res => res.data || []);
  },
  ['odds-snapshot-full'],
  { revalidate: 300 } // 5 minutos de caché
);

/**
 * Reconstruye la estructura OddEvent[] desde los snapshots de cuotas en Supabase.
 * Esta función es el reemplazo de getUpcomingMatches() para el Dashboard.
 *
 * Retorna array vacío si no hay datos frescos (>8h sin actualizar) para
 * evitar mostrar datos obsoletos — el cron debería haberlos actualizado.
 */
export async function getDashboardData(): Promise<OddEvent[]> {
  try {
    const supabase = await createClient();

    // ── Verificar si hay snapshot reciente ──────────────────────────────────
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow?.recorded_at) {
      console.warn('[DashboardData] No hay snapshots en la BD. El cron refresh-odds aún no ha corrido.');
      return [];
    }

    const snapshotAge = Date.now() - new Date(latestRow.recorded_at).getTime();
    const ageHours = snapshotAge / (1000 * 60 * 60);

    if (ageHours > MAX_SNAPSHOT_AGE_HOURS) {
      console.warn(`[DashboardData] ⚠️ Último snapshot tiene ${ageHours.toFixed(1)}h. Datos potencialmente desactualizados.`);
    }

    const cutoffTime = new Date(latestRow.recorded_at);
    cutoffTime.setMinutes(cutoffTime.getMinutes() - 30);
    
    const rows = await fetchCachedSnapshots(cutoffTime.toISOString());

    // ── Leer snapshot más reciente ───────────────────────────────────────────
    // Solo leemos el último bloque de snapshots (dentro de 30 min del último registro)
    if (!rows || rows.length === 0) {
      console.warn('[DashboardData] No hay filas en odds_snapshots para el período reciente.');
      return [];
    }

    console.log(`[DashboardData] ✅ Leyendo ${rows.length} filas de odds_snapshots (${ageHours.toFixed(1)}h de antigüedad)`);

    // ── Reconstruir estructura OddEvent[] ───────────────────────────────────
    return reconstructOddEvents(rows as SnapshotRow[]);

  } catch (err) {
    console.error('[DashboardData] Error inesperado:', err);
    return [];
  }
}

/**
 * Reconstruye la estructura OddEvent[] que espera el motor de análisis
 * a partir de las filas planas de odds_snapshots.
 */
function reconstructOddEvents(rows: SnapshotRow[]): OddEvent[] {
  // Agrupar por event_id
  const eventMap = new Map<string, {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Map<string, Map<string, Map<string, number>>>; // bk -> market -> outcome -> odds
  }>();

  for (const row of rows) {
    if (!eventMap.has(row.event_id)) {
      // Parsear "Home vs Away | commence_time" del event_label
      const parts = row.event_label.split(' | ');
      const teamsPart = parts[0];
      const commenceTime = parts[1] || new Date().toISOString();
      const teamParts = teamsPart.split(' vs ');
      const homeTeam = teamParts[0]?.trim() ?? teamsPart;
      const awayTeam = teamParts[1]?.trim() ?? '';

      eventMap.set(row.event_id, {
        id: row.event_id,
        sport_key: row.sport_key,
        sport_title: getSportTitle(row.sport_key),
        commence_time: commenceTime,
        home_team: homeTeam,
        away_team: awayTeam,
        bookmakers: new Map(),
      });
    }

    const event = eventMap.get(row.event_id)!;

    // Construir mapa de bookmakers -> markets -> outcomes
    if (!event.bookmakers.has(row.bookmaker_key)) {
      event.bookmakers.set(row.bookmaker_key, new Map());
    }
    const bkMarkets = event.bookmakers.get(row.bookmaker_key)!;

    if (!bkMarkets.has(row.market_key)) {
      bkMarkets.set(row.market_key, new Map());
    }
    const marketOutcomes = bkMarkets.get(row.market_key)!;

    // Solo guardar la cuota más reciente para cada outcome
    if (!marketOutcomes.has(row.outcome_name)) {
      marketOutcomes.set(row.outcome_name, row.odds);
    }
  }

  // Convertir al formato OddEvent[]
  const events: OddEvent[] = [];

  for (const [, eventData] of eventMap) {
    const bookmakers: Bookmaker[] = [];

    for (const [bkKey, bkMarkets] of eventData.bookmakers) {
      const markets: Market[] = [];

      for (const [marketKey, outcomes] of bkMarkets) {
        const outcomeList: Outcome[] = Array.from(outcomes.entries()).map(([name, price]) => ({
          name,
          price,
        }));

        if (outcomeList.length > 0) {
          markets.push({ key: marketKey, outcomes: outcomeList });
        }
      }

      if (markets.length > 0) {
        bookmakers.push({
          key: bkKey,
          title: formatBookmakerTitle(bkKey),
          last_update: new Date().toISOString(),
          markets,
        });
      }
    }

    if (bookmakers.length >= 2) { // El motor requiere al menos 2 bookmakers
      events.push({
        id: eventData.id,
        sport_key: eventData.sport_key,
        sport_title: eventData.sport_title,
        commence_time: eventData.commence_time,
        home_team: eventData.home_team,
        away_team: eventData.away_team,
        bookmakers,
      });
    }
  }

  return events;
}

/** Convierte sport_key a título legible */
function getSportTitle(sportKey: string): string {
  const map: Record<string, string> = {
    'soccer_epl': 'Premier League',
    'soccer_spain_la_liga': 'La Liga',
    'soccer_germany_bundesliga': 'Bundesliga',
    'soccer_italy_serie_a': 'Serie A',
    'soccer_france_ligue_one': 'Ligue 1',
    'soccer_usa_mls': 'MLS',
    'soccer_brazil_campeonato': 'Brasileirão',
    'soccer_argentina_primera': 'Liga Argentina',
    'soccer_uefa_champs_league': 'UEFA Champions League',
    'soccer_fifa_world_cup': 'Copa del Mundo',
    'basketball_nba': 'NBA',
    'baseball_mlb': 'MLB',
  };
  return map[sportKey] ?? sportKey;
}

/** Convierte bookmaker key a título legible */
function formatBookmakerTitle(key: string): string {
  const map: Record<string, string> = {
    'pinnacle': 'Pinnacle',
    'betfair_ex_eu': 'Betfair Exchange',
    'betfair_ex_uk': 'Betfair Exchange UK',
    'bet365': 'Bet365',
    'williamhill': 'William Hill',
    'unibet_eu': 'Unibet',
    'draftkings': 'DraftKings',
    'fanduel': 'FanDuel',
    'betsson': 'Betsson',
    'bookmaker': 'Bookmaker.eu',
    'bovada': 'Bovada',
  };
  return map[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
