import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getUpcomingMatches, categorizeEventsByTime } from '@/lib/apis/odds-api';
import { extractAllValueBets } from '@/lib/algorithms/value-bet-calculator';
import ValueBetsClient from './ValueBetsClient';

export default async function ValueBetsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming } = categorizeEventsByTime(allEvents);
  
  // Extraemos las oportunidades (sin límite estricto de best-per-event forzado
  // si el usuario quiere ver múltiples picks por partido en el escáner)
  // Utilizamos extractAllValueBets que retorna todas las discrepancias matemáticas.
  // Por defecto, extraemos con minValue = 1.0 para que el cliente pueda filtrar de 1 en adelante.
  const valueBets = extractAllValueBets(upcoming, 1.0, true);

  return <ValueBetsClient initialBets={valueBets} />;
}
