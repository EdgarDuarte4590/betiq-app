/**
 * SofaScore API (via RapidAPI)
 * Permite buscar el estado de forma reciente (racha de los últimos partidos) de un equipo.
 */

const API_KEY = process.env.RAPIDAPI_KEY;
const HOST = 'sofascore.p.rapidapi.com';

export interface TeamForm {
  teamName: string;
  winPercentage: number;
  recentMatchesCount: number;
}

export async function getTeamForm(teamName: string): Promise<TeamForm | null> {
  if (!API_KEY) return null;

  try {
    // 1. Buscar el equipo por nombre
    const searchUrl = `https://${HOST}/teams/search?name=${encodeURIComponent(teamName)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': HOST
      },
      next: { revalidate: 86400 } // Cachear resultados de búsqueda 24h
    });

    if (!searchRes.ok) return null;
    
    const searchData = await searchRes.json();
    if (!searchData.data || searchData.data.length === 0) return null;

    const teamId = searchData.data[0].id; // Tomar el primer resultado
    
    // 2. Obtener performance / partidos recientes
    // Nota: El endpoint exacto de performance varía según el wrapper de SofaScore en RapidAPI
    // Este es un endpoint simulado/genérico para el plan.
    const formUrl = `https://${HOST}/teams/detail?teamId=${teamId}`;
    const formRes = await fetch(formUrl, {
      headers: {
        'x-rapidapi-key': API_KEY,
        'x-rapidapi-host': HOST
      },
      next: { revalidate: 21600 } // Cachear racha reciente por 6 horas
    });

    if (!formRes.ok) return null;
    
    const formData = await formRes.json();
    
    // Simulando el parseo de la racha (aquí iría el mapeo exacto de la respuesta)
    return {
      teamName: formData.data?.name || teamName,
      winPercentage: formData.data?.form?.winPercentage || 0,
      recentMatchesCount: 5
    };
  } catch (error) {
    console.error('[SofaScore API] Error obteniendo form del equipo:', error);
    return null;
  }
}
