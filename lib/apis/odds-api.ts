// Dynamic imports are used inside functions to prevent "Module not found: fs" in Client Components
import { getActiveKey, recordKeyUsage, markKeyExhausted } from '@/lib/apis/key-manager';

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

// ========== CALENDARIO DINÁMICO DE LIGAS ==========

interface SportSchedule {
  key: string;          // sport_key de The Odds API
  label: string;        // Nombre legible
  activeFrom?: string;  // ISO date YYYY-MM-DD — null = activa desde siempre
  activeUntil?: string; // ISO date YYYY-MM-DD — null = sin fecha de fin
}

/**
 * Calendario oficial de competiciones.
 * Actualizar las fechas cuando comiencen nuevas temporadas.
 * El sistema filtra automáticamente cuáles están activas hoy.
 */
export const SPORT_SCHEDULE: SportSchedule[] = [
  // ── Fútbol: Copa del Mundo 2026 ──
  { key: 'soccer_fifa_world_cup',      label: '🏆 Copa del Mundo 2026',       activeUntil: '2026-07-19' },
  // ── Béisbol ──
  { key: 'baseball_mlb',               label: '⚾ MLB Temporada Regular',      activeFrom: '2026-03-20', activeUntil: '2026-10-31' },
  // ── Baloncesto ──
  { key: 'basketball_nba',             label: '🏀 NBA Temporada Regular',      activeFrom: '2026-10-01', activeUntil: '2027-06-30' },
  { key: 'basketball_wnba',            label: '🏀 WNBA',                       activeFrom: '2026-05-15', activeUntil: '2026-10-15' },
  // ── Fútbol: Ligas América ──
  { key: 'soccer_usa_mls',             label: '⚽ MLS',                        activeFrom: '2026-02-20', activeUntil: '2026-12-15' },
  { key: 'soccer_brazil_campeonato',   label: '⚽ Brasileirão',                activeFrom: '2026-04-01', activeUntil: '2026-12-07' },
  { key: 'soccer_argentina_primera',   label: '⚽ Liga Argentina',             activeFrom: '2026-02-01', activeUntil: '2026-12-20' },
  // ── Fútbol: Top 5 Ligas Europeas (temporada 2026-27) ──
  { key: 'soccer_epl',                 label: '⚽ Premier League',             activeFrom: '2026-08-08' },
  { key: 'soccer_spain_la_liga',       label: '⚽ La Liga',                    activeFrom: '2026-08-15' },
  { key: 'soccer_germany_bundesliga',  label: '⚽ Bundesliga',                 activeFrom: '2026-08-14' },
  { key: 'soccer_italy_serie_a',       label: '⚽ Serie A',                    activeFrom: '2026-08-22' },
  { key: 'soccer_france_ligue_one',    label: '⚽ Ligue 1',                    activeFrom: '2026-08-08' },
  // ── Champions League ──
  { key: 'soccer_uefa_champs_league',  label: '⚽ UEFA Champions League',      activeFrom: '2026-07-08' },
];

/**
 * Retorna los sport_keys que están activos en la fecha actual.
 * Compara con activeFrom y activeUntil del calendario.
 */
export function getActiveSports(referenceDate?: Date): string[] {
  const now = referenceDate ?? new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

  return SPORT_SCHEDULE
    .filter(sport => {
      const fromOk  = !sport.activeFrom  || today >= sport.activeFrom;
      const untilOk = !sport.activeUntil || today <= sport.activeUntil;
      return fromOk && untilOk;
    })
    .map(sport => sport.key);
}

/**
 * Retorna todos los sports del calendario con su estado (activo/inactivo).
 * Útil para mostrar el estado en el dashboard.
 */
export function getScheduleStatus(referenceDate?: Date): Array<SportSchedule & { isActive: boolean }> {
  const activeKeys = new Set(getActiveSports(referenceDate));
  return SPORT_SCHEDULE.map(sport => ({
    ...sport,
    isActive: activeKeys.has(sport.key),
  }));
}

/**
 * Obtiene los próximos partidos con sus cuotas de múltiples bookmakers.
 * Usa ISR de Next.js (revalidate: 21600) para cachear la respuesta 6 horas
 * y conservar las 500 requests/mes gratuitas.
 * 
 * Cuando sport === 'upcoming', consulta automáticamente todos los sports
 * activos según el calendario de competiciones (SPORT_SCHEDULE).
 */
export async function getUpcomingMatches(sport: string = 'upcoming'): Promise<OddEvent[]> {
  // MOCK SYSTEM para entorno de Desarrollo (Evita consumir peticiones reales de la API)
  if (process.env.NODE_ENV === 'development') {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const mockPath = path.join(process.cwd(), 'lib', 'apis', 'odds-mock.json');
      if (fs.existsSync(mockPath)) {
        const fileData = fs.readFileSync(mockPath, 'utf8');
        console.log('[OddsAPI] 🧪 Usando MOCK DATA local para ahorrar peticiones (odds-mock.json)');
        return JSON.parse(fileData) as OddEvent[];
      }
    } catch (e) {
      console.warn('[OddsAPI] Error leyendo mock data. Se usará la API real.', e);
    }
  }

  // Obtener la key activa del pool de rotación
  const API_KEY = await getActiveKey();
  if (!API_KEY) {
    console.error('[OddsAPI] 🚫 No hay API keys disponibles. Todas agotadas o no configuradas.');
    return [];
  }

  // Determinar qué sports consultar
  let targetSports: string[];
  if (sport === 'upcoming') {
    // Usar el calendario dinámico: solo sports activos hoy
    targetSports = getActiveSports();
    if (targetSports.length === 0) {
      console.warn('[OddsAPI] ⚠️ No hay sports activos en el calendario hoy. Verifica SPORT_SCHEDULE.');
      return [];
    }
    console.log(`[OddsAPI] 📅 Sports activos hoy (${new Date().toISOString().split('T')[0]}): ${targetSports.join(', ')}`);
  } else {
    targetSports = [sport];
  }

  try {
    const fetchPromises = targetSports.map(async (s) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const url = `https://api.the-odds-api.com/v4/sports/${s}/odds?apiKey=${API_KEY}&regions=eu,us,uk,au&markets=h2h,totals&oddsFormat=decimal`;

      const response = await fetch(url, {
        signal: controller.signal,
        next: { revalidate: 21600 }, // 6 horas
      });
      clearTimeout(timeoutId);

      // Registrar uso de la key con los headers exactos de la respuesta
      await recordKeyUsage(API_KEY, response.headers);

      if (!response.ok) {
        const used      = response.headers.get('x-requests-used');
        const remaining = response.headers.get('x-requests-remaining');
        console.error(`[OddsAPI] Falla al obtener ${s}. Código: ${response.status}. Usados: ${used}, Restantes: ${remaining}`);

        // Si es error de autenticación o rate limit, marcar key como agotada
        if (response.status === 401 || response.status === 429) {
          await markKeyExhausted(API_KEY);
          console.warn(`[OddsAPI] ⚠️ Key marcada como agotada por error ${response.status}. El próximo cron usará la siguiente key.`);
        }
        return [];
      }
      return await response.json();
    });

    const results = await Promise.all(fetchPromises);
    // Flatten array of arrays
    const allEvents: OddEvent[] = results.flat();

    // Guardamos las respuestas en el archivo mock para que la próxima vez no gaste cuotas en local
    if (process.env.NODE_ENV === 'development' && allEvents.length > 0) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const mockPath = path.join(process.cwd(), 'lib', 'apis', 'odds-mock.json');
        fs.writeFileSync(mockPath, JSON.stringify(allEvents, null, 2));
        console.log('[OddsAPI] 💾 Guardado odds-mock.json exitosamente para futuras pruebas locales');
      } catch (e) {
        console.error('[OddsAPI] Error al guardar mock data:', e);
      }
    }

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
  if (sportKey.includes('fifa') || sportKey.includes('world_cup')) return { icon: '🏆', color: '#fbbf24' };
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
