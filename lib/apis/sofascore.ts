/**
 * SofaScore API (via RapidAPI)
 * Permite buscar el estado de forma reciente (racha de los últimos partidos) de un equipo.
 */

const API_KEY = process.env.RAPIDAPI_KEY;
const HOST = 'sofascore6.p.rapidapi.com';

export interface TeamForm {
  teamName: string;
  winPercentage: number;
  recentMatchesCount: number;
}

export async function getTeamForm(teamName: string): Promise<TeamForm | null> {
  if (!API_KEY) return null;

  try {
    // 1. Buscar el equipo por nombre
    const searchUrl = `https://${HOST}/api/sofascore/v1/search/all?q=${encodeURIComponent(teamName)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': HOST
      },
      next: { revalidate: 86400 } // Cachear resultados de búsqueda 24h
    });

    if (!searchRes.ok) return null;
    
    const searchData = await searchRes.json();
    if (!searchData || searchData.length === 0 || !searchData[0].entity) return null;

    const teamId = searchData[0].entity.id;
    
    // 2. Obtener performance / partidos recientes
    const formUrl = `https://${HOST}/api/sofascore/v1/team/matches/finished?team_id=${teamId}`;
    const formRes = await fetch(formUrl, {
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': HOST
      },
      next: { revalidate: 21600 } // Cachear racha reciente por 6 horas
    });

    if (!formRes.ok) return null;
    
    const formData = await formRes.json();
    if (!formData.events || formData.events.length === 0) return null;

    // Calcular el % de victorias en los últimos 5 partidos
    const recentEvents = formData.events.slice(0, 5);
    let wins = 0;

    for (const event of recentEvents) {
      // winnerCode: 1 = local, 2 = visitante, 3 = empate
      const isHome = event.homeTeam.id === teamId;
      const isAway = event.awayTeam.id === teamId;

      if (isHome && event.winnerCode === 1) wins++;
      if (isAway && event.winnerCode === 2) wins++;
    }

    const winPercentage = (wins / recentEvents.length) * 100;

    return {
      teamName: searchData[0].entity.name || teamName,
      winPercentage,
      recentMatchesCount: recentEvents.length
    };
  } catch (error) {
    console.error('[SofaScore API] Error obteniendo form del equipo:', error);
    return null;
  }
}
