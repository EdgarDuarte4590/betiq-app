'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { OddEvent, Bookmaker, Market, Outcome } from '@/lib/apis/odds-api';

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 horas

export async function saveOddsSnapshot(events: OddEvent[]) {
  const supabase = createAdminClient();
  const now = new Date();

  // ── Rate-limit: solo guardar si no hay snapshot reciente (< 5h) ──
  try {
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow?.recorded_at) {
      const lastSaved = new Date(latestRow.recorded_at).getTime();
      if (now.getTime() - lastSaved < SNAPSHOT_INTERVAL_MS) {
        console.log('[Snapshots] Snapshot reciente encontrado, omitiendo escritura.');
        return; // Ya hay un snapshot reciente, no duplicar
      }
    }
  } catch {
    // Si la tabla no existe o hay error, continuamos y guardamos
  }

  const nowIso = now.toISOString();
  const maxFutureMs = 72 * 60 * 60 * 1000; // Solo partidos de los próximos 3 días (72h)
  const nowMs = now.getTime();

  // Filtrar eventos que no sean lejanos (ej. semanas adelante) para reducir peso y tiempo
  const relevantEvents = events.filter(e => {
    const eventTime = new Date(e.commence_time).getTime();
    return eventTime >= nowMs && (eventTime - nowMs) <= maxFutureMs;
  });

  const rows = relevantEvents.flatMap(event =>
    event.bookmakers.flatMap(bk =>
      (bk.markets ?? []).flatMap(market =>
        (market.outcomes ?? []).map(outcome => ({
          event_id: event.id,
          event_label: `${event.home_team} vs ${event.away_team}`,
          sport_key: event.sport_key,
          bookmaker_key: bk.key,
          market_key: market.key,
          // La tabla no tiene columna `point`: codificamos la línea de totales
          // en el nombre ("Over 8.5") para no mezclar líneas distintas entre casas.
          outcome_name: outcome.point !== undefined && outcome.point !== null
            ? `${outcome.name} ${outcome.point}`
            : outcome.name,
          odds: outcome.price,
          recorded_at: nowIso,
          commence_time: event.commence_time,
        }))
      )
    )
  );

  if (rows.length === 0) return;

  // Inserción en lotes paralelos (chunks) ultra-rápida
  const CHUNK_SIZE = 500;
  console.log(`[Snapshots] Guardando ${rows.length} registros en lotes de ${CHUNK_SIZE}...`);
  const chunks: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }

  // Ejecutar inserciones en paralelo para terminar en 1-2 segundos
  await Promise.all(
    chunks.map(chunk =>
      supabase.from('odds_snapshots').insert(chunk)
    )
  );
  console.log('[Snapshots] ✅ Snapshot guardado exitosamente.');
}

/**
 * Lee el snapshot más reciente de odds_snapshots (últimas 7 horas) y
 * reconstruye los OddEvent[] para que el cron send-picks no necesite
 * llamar a The Odds API de nuevo (ahorrando requests del plan mensual).
 *
 * Retorna:
 *   - { events, fresh: true }  — si hay datos recientes (< 7h)
 *   - { events: [], fresh: false } — si el snapshot está vacío o muy antiguo
 */
export async function getLatestEventsFromSnapshot(): Promise<{
  events: OddEvent[];
  fresh: boolean;
  snapshotAge: number | null; // minutos desde el último snapshot
}> {
  try {
    const supabase = createAdminClient();

    // 1. Verificar que hay un snapshot reciente
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow?.recorded_at) {
      console.log('[Snapshots] No hay snapshots en la BD.');
      return { events: [], fresh: false, snapshotAge: null };
    }

    const snapshotAgeMs = Date.now() - new Date(latestRow.recorded_at).getTime();
    const snapshotAgeMins = Math.round(snapshotAgeMs / 60_000);

    if (snapshotAgeMs > 7 * 60 * 60 * 1000) {
      console.warn(`[Snapshots] Snapshot demasiado antiguo (${snapshotAgeMins} min). Se usará la API.`);
      return { events: [], fresh: false, snapshotAge: snapshotAgeMins };
    }

    // 2. Leer TODAS las filas del snapshot más reciente (misma recorded_at).
    //    Supabase limita cada query a 1000 filas → hay que paginar, si no se
    //    pierden ligas enteras cuando el snapshot es grande (MLB, Nations League...).
    const PAGE_SIZE = 1000;
    const rows: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error } = await supabase
        .from('odds_snapshots')
        .select('event_id, event_label, sport_key, bookmaker_key, market_key, outcome_name, odds, recorded_at, commence_time')
        .eq('recorded_at', latestRow.recorded_at)
        // OJO: NO ordenar por `id` → Postgres recorre todo el índice PK de la
        // tabla (millones de filas) y da "statement timeout". Ordenar por la
        // clave natural del snapshot es rápido y determinista para paginar.
        .order('event_id', { ascending: true })
        .order('bookmaker_key', { ascending: true })
        .order('market_key', { ascending: true })
        .order('outcome_name', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.warn('[Snapshots] Error paginando snapshot:', error.message);
        break;
      }
      if (!page || page.length === 0) break;
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    if (rows.length === 0) {
      console.warn('[Snapshots] Sin filas en el snapshot más reciente');
      return { events: [], fresh: false, snapshotAge: snapshotAgeMins };
    }

    // 3. Reconstruir OddEvent[] agrupando por event_id → bookmaker → market
    const eventMap = new Map<string, OddEvent>();

    for (const row of rows) {
      if (!eventMap.has(row.event_id)) {
        // Parsear home_team / away_team desde event_label "home vs away"
        const [homeTeam, awayTeam] = (row.event_label as string).split(' vs ');
        eventMap.set(row.event_id, {
          id:            row.event_id,
          sport_key:     row.sport_key,
          sport_title:   row.sport_key,  // título exacto no disponible en el snapshot
          commence_time: row.commence_time ?? latestRow.recorded_at, // usar fecha real del partido
          home_team:     homeTeam?.trim() ?? '',
          away_team:     awayTeam?.trim() ?? '',
          bookmakers:    [],
        });
      }

      const event = eventMap.get(row.event_id)!;

      // Buscar o crear bookmaker
      let bk = event.bookmakers.find(b => b.key === row.bookmaker_key);
      if (!bk) {
        bk = { key: row.bookmaker_key, title: row.bookmaker_key, last_update: row.recorded_at, markets: [] };
        event.bookmakers.push(bk);
      }

      // Buscar o crear market
      let market = bk.markets.find(m => m.key === row.market_key);
      if (!market) {
        market = { key: row.market_key, outcomes: [] };
        bk.markets.push(market);
      }

      // Decodificar línea de totales: "Over 8.5" → { name: 'Over', point: 8.5 }
      let outcomeName: string = row.outcome_name;
      let point: number | undefined;
      if (row.market_key === 'totals') {
        const m = /^(Over|Under)\s+(-?\d+(?:\.\d+)?)$/.exec(outcomeName);
        if (m) {
          outcomeName = m[1];
          point = parseFloat(m[2]);
        }
      }

      // Agregar outcome (evitar duplicados por nombre + línea)
      const alreadyExists = market.outcomes.some(o => o.name === outcomeName && o.point === point);
      if (!alreadyExists) {
        const outcome: Outcome = { name: outcomeName, price: row.odds };
        if (point !== undefined) outcome.point = point;
        market.outcomes.push(outcome);
      }
    }

    const events = Array.from(eventMap.values());
    console.log(`[Snapshots] ✅ ${events.length} eventos reconstruidos desde snapshot (${snapshotAgeMins} min de antigüedad)`);
    return { events, fresh: true, snapshotAge: snapshotAgeMins };

  } catch (err) {
    console.error('[Snapshots] Error leyendo snapshot:', err);
    return { events: [], fresh: false, snapshotAge: null };
  }
}

