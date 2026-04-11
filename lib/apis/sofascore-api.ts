/**
 * Módulo para extraer el Performance de un equipo desde RapidAPI (SofaScore).
 * 
 * NOTA: Actualmente utilizando un MOCK porque la llave de RapidAPI requiere 
 * suscripción en la consola web para el plan Basic/Free.
 */

// Función utilitaria para crear siempre el mismo número aleatorio a partir de un texto (Seeded Random)
function getSeededRandom(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const x = Math.sin(hash++) * 10000;
  return x - Math.floor(x);
}

export async function getTeamTrueWinProbability(teamName: string): Promise<number> {
  // TODO: Reemplazar con la llamada REAL a SofaScore cuando el API key se inscriba al plan gratis
  /*
    const response = await fetch(`https://sofascore.p.rapidapi.com/teams/search?name=${teamName}`, ...);
    const teamId = response.data[0].id;
    const performance = await fetch(`https://sofascore.p.rapidapi.com/teams/${teamId}/performance`);
    return (performance.wins / performance.total_matches);
  */
  
  // Simulamos un retraso de red
  await new Promise(resolve => setTimeout(resolve, 300));

  // Genera una probabilidad "falsa" pero siempre idéntica para el mismo equipo (entre 30% a 70%)
  const seeded = getSeededRandom(teamName);
  const minProb = 0.30;
  const maxProb = 0.70;
  
  return minProb + (seeded * (maxProb - minProb));
}
