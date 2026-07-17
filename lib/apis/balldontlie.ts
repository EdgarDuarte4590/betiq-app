/**
 * BallDontLie API Integration
 * API para obtener estadísticas hiper detalladas de equipos y jugadores de la NBA.
 * Actualmente inactivo hasta el inicio de la temporada.
 */

const API_KEY = process.env.BALLDONTLIE_API_KEY;
const BASE_URL = 'https://api.balldontlie.io/v1';

export interface NBATeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface NBATeamRecord {
  wins: number;
  losses: number;
  winPercentage: number;
}

/**
 * Busca un equipo de la NBA por nombre.
 */
export async function searchNBATeam(teamName: string): Promise<NBATeam | null> {
  if (!API_KEY) return null;
  
  try {
    const res = await fetch(`${BASE_URL}/teams`, {
      headers: { 'Authorization': API_KEY },
      next: { revalidate: 86400 } // Cachear por 24h
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const teams: NBATeam[] = data.data;
    
    // Buscar coincidencia parcial (ej. "Lakers" en "Los Angeles Lakers")
    const match = teams.find(t => 
      t.full_name.toLowerCase().includes(teamName.toLowerCase()) || 
      t.name.toLowerCase() === teamName.toLowerCase()
    );
    
    return match || null;
  } catch (error) {
    console.error('[BallDontLie] Error buscando equipo:', error);
    return null;
  }
}

/**
 * Función (inactiva) preparada para extraer el récord de un equipo.
 * Cuando inicie la temporada, se consultarán los `games` o `standings` 
 * para calcular el récord actual y usarlo en el Value Bet Calculator.
 */
export async function getNBATeamRecord(teamId: number, season: number = 2026): Promise<NBATeamRecord | null> {
  // TODO: Implementar consulta a /games o /standings cuando inicie la temporada
  // Retornando mock temporalmente
  return {
    wins: 0,
    losses: 0,
    winPercentage: 0
  };
}
