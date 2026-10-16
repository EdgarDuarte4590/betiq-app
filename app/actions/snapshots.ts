'use server';
import { createAdminClient } from '@/lib/supabase/admin';
import { OddEvent, Outcome } from '@/lib/apis/odds-api';
import { powerDevig } from '@/lib/algorithms/value-bet-calculator';

const SNAPSHOT_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 horas entre snapshots para capturar movimientos intra-día y CLV
const PK_SCAN_WINDOW = 25000; // Ventana en el índice primario `id` para evitar sequential scan en millones de filas

const SHARP_BOOKS = new Set(['pinnacle', 'betfair_ex_eu', 'betfair_ex_uk', 'matchbook', 'bookmaker']);

export async function saveOddsSnapshot(events: OddEvent[], force: boolean = false) {
  if (!events || events.length === 0) return;

  const supabase = createAdminClient();
  const now = new Date();

  // ── Rate-limit usando el índice PK `id DESC` (evita statement timeout 57014) ──
  let latestId = 0;
  try {
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('id, recorded_at')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow?.id) {
      latestId = latestRow.id;
    }

    if (!force && latestRow?.recorded_at) {
      const lastSaved = new Date(latestRow.recorded_at).getTime();
      if (now.getTime() - lastSaved < SNAPSHOT_INTERVAL_MS) {
        console.log('[Snapshots] Snapshot reciente encontrado (<3h), omitiendo escritura.');
        return;
      }
    }
  } catch {
    // Continuar si hubo error leyendo
  }

  const nowIso = now.toISOString();
  const maxFutureMs = 72 * 60 * 60 * 1000; // Próximos 3 días (72h)
  const nowMs = now.getTime();

  const relevantEvents = events.filter(e => {
    const eventTime = new Date(e.commence_time).getTime();
    return eventTime >= nowMs - 30 * 60 * 1000 && (eventTime - nowMs) <= maxFutureMs;
  });

  const rows = relevantEvents.flatMap(event =>
    (event.bookmakers ?? []).flatMap(bk =>
      (bk.markets ?? []).flatMap(market =>
        (market.outcomes ?? []).map(outcome => ({
          event_id: event.id,
          event_label: `${event.home_team} vs ${event.away_team}`,
          sport_key: event.sport_key,
          bookmaker_key: bk.key,
          market_key: market.key,
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

  const CHUNK_SIZE = 500;
  console.log(`[Snapshots] Guardando ${rows.length} registros en lotes de ${CHUNK_SIZE}...`);
  const chunks: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map(chunk => supabase.from('odds_snapshots').insert(chunk))
  );

  const firstError = results.find(r => r.error)?.error;
  if (firstError) {
    console.warn('[Snapshots] Advertencia insertando lote en odds_snapshots:', firstError.message);
  } else {
    console.log('[Snapshots] ✅ Snapshot guardado exitosamente.');
  }

  // Limpieza asíncrona acotada por PK para evitar crecimiento infinito de la tabla
  if (latestId > 150000) {
    const pruneThreshold = latestId - 120000;
    void (async () => {
      try {
        await supabase
          .from('odds_snapshots')
          .delete()
          .lt('id', pruneThreshold)
          .gte('id', pruneThreshold - 3000);
      } catch {
        // Silencioso
      }
    })();
  }
}

/**
 * Lee el snapshot más reciente de odds_snapshots usando el índice PK `id`
 * para responder en ~200ms sin sufrir statement timeout (57014).
 *
 * Además verifica que existan partidos futuros (`commence_time > now`);
 * si hay 0 partidos futuros válidos, marca `fresh: false` para forzar actualización.
 */
export async function getLatestEventsFromSnapshot(maxAgeHours: number = 4): Promise<{
  events: OddEvent[];
  fresh: boolean;
  snapshotAge: number | null;
  futureEventsCount: number;
}> {
  try {
    const supabase = createAdminClient();

    // 1. Obtener la última fila usando el índice primario `id DESC` (~200ms)
    const { data: latestRow, error: latestError } = await supabase
      .from('odds_snapshots')
      .select('id, recorded_at')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError || !latestRow?.recorded_at) {
      console.log('[Snapshots] No hay snapshots accesibles en la BD:', latestError?.message ?? 'vacío');
      return { events: [], fresh: false, snapshotAge: null, futureEventsCount: 0 };
    }

    const snapshotAgeMs = Date.now() - new Date(latestRow.recorded_at).getTime();
    const snapshotAgeMins = Math.round(snapshotAgeMs / 60_000);

    if (snapshotAgeMs > maxAgeHours * 60 * 60 * 1000) {
      console.warn(`[Snapshots] Snapshot antiguo (${snapshotAgeMins} min > ${maxAgeHours * 60} min). Se requerirá API.`);
      return { events: [], fresh: false, snapshotAge: snapshotAgeMins, futureEventsCount: 0 };
    }

    // 2. Leer todas las filas del snapshot acotando por `id >= latestRow.id - PK_SCAN_WINDOW`
    //    Esto obliga a Postgres a usar el B-Tree PK index en lugar de un Seq Scan sobre 1.4M de filas.
    const minIdBound = Math.max(1, Number(latestRow.id) - PK_SCAN_WINDOW);
    const PAGE_SIZE = 1000;
    const rows: any[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error } = await supabase
        .from('odds_snapshots')
        .select('id, event_id, event_label, sport_key, bookmaker_key, market_key, outcome_name, odds, recorded_at, commence_time')
        .gte('id', minIdBound)
        .eq('recorded_at', latestRow.recorded_at)
        .order('id', { ascending: true })
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
      return { events: [], fresh: false, snapshotAge: snapshotAgeMins, futureEventsCount: 0 };
    }

    // 3. Reconstruir OddEvent[]
    const eventMap = new Map<string, OddEvent>();

    for (const row of rows) {
      if (!eventMap.has(row.event_id)) {
        const [homeTeam, awayTeam] = (row.event_label as string).split(' vs ');
        eventMap.set(row.event_id, {
          id:            row.event_id,
          sport_key:     row.sport_key,
          sport_title:   row.sport_key,
          commence_time: row.commence_time ?? latestRow.recorded_at,
          home_team:     homeTeam?.trim() ?? '',
          away_team:     awayTeam?.trim() ?? '',
          bookmakers:    [],
        });
      }

      const event = eventMap.get(row.event_id)!;

      let bk = event.bookmakers.find(b => b.key === row.bookmaker_key);
      if (!bk) {
        bk = { key: row.bookmaker_key, title: row.bookmaker_key, last_update: row.recorded_at, markets: [] };
        event.bookmakers.push(bk);
      }

      let market = bk.markets.find(m => m.key === row.market_key);
      if (!market) {
        market = { key: row.market_key, outcomes: [] };
        bk.markets.push(market);
      }

      let outcomeName: string = row.outcome_name;
      let point: number | undefined;
      if (row.market_key === 'totals') {
        const m = /^(Over|Under)\s+(-?\d+(?:\.\d+)?)$/.exec(outcomeName);
        if (m) {
          outcomeName = m[1];
          point = parseFloat(m[2]);
        }
      }

      const alreadyExists = market.outcomes.some(o => o.name === outcomeName && o.point === point);
      if (!alreadyExists) {
        const outcome: Outcome = { name: outcomeName, price: Number(row.odds) };
        if (point !== undefined) outcome.point = point;
        market.outcomes.push(outcome);
      }
    }

    const events = Array.from(eventMap.values());
    const nowMs = Date.now();
    const futureEventsCount = events.filter(e => new Date(e.commence_time).getTime() > nowMs).length;

    const isFresh = futureEventsCount > 0;
    console.log(
      `[Snapshots] ✅ ${events.length} eventos (${futureEventsCount} futuros) reconstruidos (${snapshotAgeMins} min de antigüedad)`
    );

    return { events, fresh: isFresh, snapshotAge: snapshotAgeMins, futureEventsCount };
  } catch (err) {
    console.error('[Snapshots] Error leyendo snapshot:', err);
    return { events: [], fresh: false, snapshotAge: null, futureEventsCount: 0 };
  }
}

export interface SteamMoveAlert {
  eventId: string;
  eventLabel: string;
  sportKey: string;
  marketKey: string;
  outcomeName: string;
  pickFormatted: string;
  oldOdds: number;
  newOdds: number;
  impliedProbDeltaPct: number; // +4.5 significa +4.5% subida en prob implícita sharp
  bookmaker: string;
  commenceTime: string;
}

/**
 * Detecta "Steam Moves" (caídas abruptas de cuota en casas sharp donde la probabilidad
 * implícita sube >= 4.0% entre snapshots recientes).
 */
export async function detectSteamMoves(currentEvents?: OddEvent[]): Promise<{
  steamMap: Map<string, SteamMoveAlert>;
  steamList: SteamMoveAlert[];
}> {
  const steamMap = new Map<string, SteamMoveAlert>();
  try {
    const supabase = createAdminClient();

    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('id, recorded_at')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow?.id) {
      return { steamMap, steamList: [] };
    }

    // Buscar filas de las últimas ~45,000 inserciones (cubre los últimos 2-3 snapshots)
    const minId = Math.max(1, Number(latestRow.id) - 45000);
    const { data: recentRows } = await supabase
      .from('odds_snapshots')
      .select('event_id, event_label, sport_key, bookmaker_key, market_key, outcome_name, odds, recorded_at, commence_time')
      .gte('id', minId)
      .in('bookmaker_key', Array.from(SHARP_BOOKS))
      .order('id', { ascending: true })
      .limit(3000);

    if (!recentRows || recentRows.length === 0) {
      return { steamMap, steamList: [] };
    }

    // Agrupar por event_id + bookmaker_key + market_key + outcome_name
    const historyMap = new Map<string, { odds: number; recorded_at: string; row: any }[]>();
    for (const r of recentRows) {
      const key = `${r.event_id}::${r.bookmaker_key}::${r.market_key}::${r.outcome_name}`;
      if (!historyMap.has(key)) historyMap.set(key, []);
      historyMap.get(key)!.push({ odds: Number(r.odds), recorded_at: r.recorded_at, row: r });
    }

    // Si además tenemos currentEvents en vivo, añadir sus precios actuales al final
    if (currentEvents && currentEvents.length > 0) {
      const nowIso = new Date().toISOString();
      for (const ev of currentEvents) {
        for (const bk of ev.bookmakers ?? []) {
          if (!SHARP_BOOKS.has(bk.key)) continue;
          for (const mkt of bk.markets ?? []) {
            for (const o of mkt.outcomes ?? []) {
              const outName = o.point !== undefined && o.point !== null ? `${o.name} ${o.point}` : o.name;
              const key = `${ev.id}::${bk.key}::${mkt.key}::${outName}`;
              if (!historyMap.has(key)) historyMap.set(key, []);
              historyMap.get(key)!.push({
                odds: o.price,
                recorded_at: nowIso,
                row: {
                  event_id: ev.id,
                  event_label: `${ev.home_team} vs ${ev.away_team}`,
                  sport_key: ev.sport_key,
                  bookmaker_key: bk.key,
                  market_key: mkt.key,
                  outcome_name: outName,
                  commence_time: ev.commence_time,
                },
              });
            }
          }
        }
      }
    }

    for (const [, points] of historyMap.entries()) {
      if (points.length < 2) continue;
      const first = points[0];
      const last = points[points.length - 1];
      if (first.odds <= 1 || last.odds <= 1 || last.odds >= first.odds) continue;

      const oldImplied = (1 / first.odds) * 100;
      const newImplied = (1 / last.odds) * 100;
      const deltaPct = newImplied - oldImplied;

      // Steam Move: subida >= 4.0% en probabilidad implícita sharp
      if (deltaPct >= 4.0) {
        const r = last.row;
        const isH2H = r.market_key === 'h2h';
        const isDraw = r.outcome_name === 'Draw' || r.outcome_name === 'Empate';
        const pickFormatted = isH2H
          ? (isDraw ? 'Empate' : `Gana ${r.outcome_name}`)
          : r.outcome_name;

        const lookupKey = `${r.event_id}::${pickFormatted}`;
        const existing = steamMap.get(lookupKey);
        if (!existing || deltaPct > existing.impliedProbDeltaPct) {
          steamMap.set(lookupKey, {
            eventId: r.event_id,
            eventLabel: r.event_label,
            sportKey: r.sport_key,
            marketKey: r.market_key,
            outcomeName: r.outcome_name,
            pickFormatted,
            oldOdds: first.odds,
            newOdds: last.odds,
            impliedProbDeltaPct: Number(deltaPct.toFixed(2)),
            bookmaker: r.bookmaker_key,
            commenceTime: r.commence_time,
          });
        }
      }
    }

    return {
      steamMap,
      steamList: Array.from(steamMap.values()).sort((a, b) => b.impliedProbDeltaPct - a.impliedProbDeltaPct),
    };
  } catch (err) {
    console.warn('[Snapshots] Error detectando Steam Moves:', err);
    return { steamMap, steamList: [] };
  }
}

/**
 * Calcula el Closing Line Value (CLV %) para un conjunto de apuestas buscando
 * la línea de cierre sin vig (Power Devigging) en los snapshots recientes.
 *
 * Fórmula institucional:
 *   CLV% = ((O_taken / O_closing_no_vig) - 1) * 100
 */
export async function computeClvForBets(
  bets: Array<{
    id: string;
    event: string;
    pick: string;
    market: string;
    odds: number;
    match_time?: string | null;
  }>
): Promise<Record<string, { closingNoVigOdds: number; closingTrueProb: number; clvPct: number }>> {
  const result: Record<string, { closingNoVigOdds: number; closingTrueProb: number; clvPct: number }> = {};
  if (!bets || bets.length === 0) return result;

  try {
    const supabase = createAdminClient();
    const { data: latestRow } = await supabase
      .from('odds_snapshots')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRow?.id) return result;

    const minId = Math.max(1, Number(latestRow.id) - 40000);
    const eventNames = Array.from(new Set(bets.map(b => b.event).filter(Boolean)));
    if (eventNames.length === 0) return result;

    const { data: rows } = await supabase
      .from('odds_snapshots')
      .select('event_label, bookmaker_key, market_key, outcome_name, odds, recorded_at')
      .gte('id', minId)
      .in('event_label', eventNames.slice(0, 30))
      .order('id', { ascending: false })
      .limit(2000);

    if (!rows || rows.length === 0) return result;

    for (const bet of bets) {
      const eventRows = rows.filter(r => r.event_label === bet.event);
      if (eventRows.length === 0) continue;

      // Tomar el último snapshot registrado para este evento
      const latestRecordedAt = eventRows[0].recorded_at;
      const closingRows = eventRows.filter(r => r.recorded_at === latestRecordedAt);

      const isTotals = /over|under|goles|puntos|carreras/i.test(bet.market) || /^(over|under)\s/i.test(bet.pick);
      const targetMarketKey = isTotals ? 'totals' : 'h2h';
      const mktRows = closingRows.filter(r => r.market_key === targetMarketKey);
      if (mktRows.length < 2) continue;

      // Agrupar por bookmaker para hacer Power Devigging de la línea de cierre
      const byBook = new Map<string, { outcome: string; odds: number }[]>();
      for (const r of mktRows) {
        if (!byBook.has(r.bookmaker_key)) byBook.set(r.bookmaker_key, []);
        byBook.get(r.bookmaker_key)!.push({ outcome: r.outcome_name, odds: Number(r.odds) });
      }

      // Buscar el outcome correspondiente al pick del usuario
      const cleanPick = bet.pick.replace(/^Gana\s+/i, '').replace(/🔥/g, '').trim();
      const targetOutcome = cleanPick === 'Empate' ? 'Draw' : cleanPick;

      const trueProbsForPick: number[] = [];
      for (const [bkKey, outcomes] of byBook.entries()) {
        if (outcomes.length < 2) continue;
        const devigged = powerDevig(outcomes.map(o => o.odds));
        const idx = outcomes.findIndex(
          o =>
            o.outcome.toLowerCase() === targetOutcome.toLowerCase() ||
            o.outcome.toLowerCase() === cleanPick.toLowerCase()
        );
        if (idx >= 0 && devigged[idx] > 0) {
          // Ponderar doble si es casa sharp
          trueProbsForPick.push(devigged[idx]);
          if (SHARP_BOOKS.has(bkKey)) trueProbsForPick.push(devigged[idx]);
        }
      }

      if (trueProbsForPick.length > 0) {
        const closingTrueProb = trueProbsForPick.reduce((s, p) => s + p, 0) / trueProbsForPick.length;
        const closingNoVigOdds = Number((1 / closingTrueProb).toFixed(3));
        const clvPct = Number((((bet.odds / closingNoVigOdds) - 1) * 100).toFixed(2));
        result[bet.id] = {
          closingNoVigOdds,
          closingTrueProb,
          clvPct,
        };
      }
    }
  } catch (err) {
    console.warn('[Snapshots] Error calculando CLV:', err);
  }

  return result;
}
