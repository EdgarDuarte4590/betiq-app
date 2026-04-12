export interface OddEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface Market {
  key: string;
  outcomes: Outcome[];
}

export interface Outcome {
  name: string;
  price: number;
}

/**
 * Obtiene los próximos partidos con sus cuotas de múltiples bookmakers.
 * Usa ISR de Next.js (revalidate: 3600) para cachear la respuesta 1 hora
 * y conservar las 500 requests/mes gratuitas.
 */
export async function getUpcomingMatches(sport: string = 'upcoming'): Promise<OddEvent[]> {
  const API_KEY = process.env.THE_ODDS_API_KEY;
  if (!API_KEY) {
    console.warn('[OddsAPI] Falta THE_ODDS_API_KEY en .env.local');
    return [];
  }

  // 8 ligas * 3 peticiones al día (cada 8h) = 24 peticiones/día = 720/mes. (Plan gratis: 500/mes para una feature o 1000 sumadas, adaptado a los límites del usuario).
  let targetSports = [sport];
  if (sport === 'upcoming') {
    targetSports = [
      'soccer_epl',
      'soccer_spain_la_liga',
      'soccer_uefa_champs_league',
      'soccer_france_ligue_one',
      'soccer_italy_serie_a',
      'soccer_germany_bundesliga',
      'basketball_nba',
      'baseball_mlb',
    ];
  }

  try {
    const fetchPromises = targetSports.map(async (s) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const url = `https://api.the-odds-api.com/v4/sports/${s}/odds?apiKey=${API_KEY}&regions=eu,us,uk,au&markets=h2h,totals&oddsFormat=decimal`;
      
      const response = await fetch(url, {
        signal: controller.signal,
        next: { revalidate: 28800 }, // 8 horas (8 sports * 3/día = 24/día = 720/mes)
      });
      clearTimeout(timeoutId);

      if (!response.ok) return [];
      return await response.json();
    });

    const results = await Promise.all(fetchPromises);
    // Flatten array of arrays
    const allEvents: OddEvent[] = results.flat();
    return allEvents;
  } catch (error: any) {
    console.error('[OddsAPI] Error de red principal:', error);
    return [];
  }
}

/**
 * Filtra los eventos de la API por tiempo para separarlos en:
 * - upcoming: partidos que no han comenzado (commence_time > ahora)
 * - recent: partidos que empezaron hace menos de 3h (pueden seguir en juego)
 * 
 * Esto evita mostrar partidos que ya terminaron.
 */
export function categorizeEventsByTime(events: OddEvent[]): {
  upcoming: OddEvent[];
  possiblyLive: OddEvent[];
} {
  const now = Date.now();
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

  const upcoming: OddEvent[] = [];
  const possiblyLive: OddEvent[] = [];

  for (const event of events) {
    const startTime = new Date(event.commence_time).getTime();
    const diffMs = startTime - now;

    if (diffMs > 0) {
      // No ha comenzado aún
      upcoming.push(event);
    } else if (Math.abs(diffMs) < THREE_HOURS_MS) {
      // Comenzó hace menos de 3 horas — posiblemente en vivo
      possiblyLive.push(event);
    }
    // Si comenzó hace más de 3h, lo descartamos (ya terminó)
  }

  return { upcoming, possiblyLive };
}

/**
 * Retorna el ícono de emoji y el color del deporte
 */
export function getSportMeta(sportKey: string): { icon: string; color: string } {
  if (sportKey.includes('soccer')) return { icon: '⚽', color: '#4ade80' };
  if (sportKey.includes('basketball')) return { icon: '🏀', color: '#fb923c' };
  if (sportKey.includes('baseball')) return { icon: '⚾', color: '#60a5fa' };
  if (sportKey.includes('americanfootball')) return { icon: '🏈', color: '#a78bfa' };
  if (sportKey.includes('hockey')) return { icon: '🏒', color: '#67e8f9' };
  if (sportKey.includes('tennis')) return { icon: '🎾', color: '#fbbf24' };
  if (sportKey.includes('mma')) return { icon: '🥊', color: '#f87171' };
  if (sportKey.includes('cricket')) return { icon: '🏏', color: '#86efac' };
  return { icon: '🏟️', color: '#94a3b8' };
}
