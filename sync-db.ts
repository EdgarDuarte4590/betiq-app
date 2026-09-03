import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const API_KEY = process.env.THE_ODDS_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Faltan variables de entorno en .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SPORTS = [
  'baseball_mlb', 'soccer_usa_mls', 'soccer_brazil_campeonato', 
  'soccer_argentina_primera', 'soccer_epl', 'soccer_spain_la_liga', 
  'soccer_germany_bundesliga', 'soccer_italy_serie_a', 
  'soccer_france_ligue_one', 'soccer_uefa_champs_league'
];

async function run() {
  console.log("Iniciando sincronización manual con The Odds API...");
  let allEvents = [];

  for (const sport of SPORTS) {
    try {
      console.log(`Descargando ${sport}...`);
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${API_KEY}&regions=eu,us,uk,au&markets=h2h,totals&oddsFormat=decimal`;
      
      // Usamos curl.exe nativo de Windows para evitar el bloqueo TLS de Cloudflare a Node.js
      const curlCmd = `curl.exe -s -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "${url}"`;
      const stdout = execSync(curlCmd, { encoding: 'utf-8', stdio: 'pipe' });
      
      const data = JSON.parse(stdout);
      if (Array.isArray(data)) {
        allEvents.push(...data);
      } else {
        console.error(`Respuesta inesperada para ${sport}:`, stdout.substring(0, 100));
      }
      
      // Pequeña pausa para no saturar la API
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`Error en ${sport}:`, e.message || 'Error desconocido al ejecutar curl');
    }
  }

  console.log(`Total de partidos descargados: ${allEvents.length}`);
  if (allEvents.length === 0) {
    console.log("No se encontraron partidos. Verifica tu API Key o límites.");
    return;
  }

  const nowIso = new Date().toISOString();
  console.log("Procesando datos para Supabase...");
  
  const rows = allEvents.flatMap(event =>
    event.bookmakers.flatMap(bk =>
      (bk.markets ?? []).flatMap(market =>
        (market.outcomes ?? []).map(outcome => ({
          event_id: event.id,
          event_label: `${event.home_team} vs ${event.away_team} | ${event.commence_time}`,
          sport_key: event.sport_key,
          bookmaker_key: bk.key,
          market_key: market.key,
          outcome_name: outcome.name,
          odds: outcome.price,
          recorded_at: nowIso,
        }))
      )
    )
  );

  console.log(`Insertando ${rows.length} cuotas en la base de datos...`);
  
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error } = await supabase.from('odds_snapshots').insert(batch);
    if (error) {
      console.error('Error insertando en Supabase:', error);
    } else {
      console.log(`Lote ${i} a ${i + batch.length} insertado correctamente.`);
    }
  }

  console.log("✅ ¡Sincronización completada! Ya puedes refrescar tu Dashboard.");
}

run();
