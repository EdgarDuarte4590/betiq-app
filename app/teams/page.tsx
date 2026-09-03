import { Users, Activity, BarChart3 } from 'lucide-react';
import { getUpcomingMatches, categorizeEventsByTime, getSportMeta } from '@/lib/apis/odds-api';
import { isMainSport, removeVig } from '@/lib/algorithms/value-bet-calculator';

export default async function TeamsPage() {
  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming, possiblyLive } = categorizeEventsByTime(allEvents);
  const allValid = [...upcoming, ...possiblyLive];

  // Solo deportes principales
  const mainEvents = allValid.filter(e => isMainSport(e.sport_key));

  // Agrupar por deporte
  type TeamEntry = {
    name: string;
    sport: string;
    league: string;
    odds: number[];
    nextMatch: string;
    nextTime: string;
    bookmakerCount: number;
  };

  const teamMap = new Map<string, TeamEntry>();

  for (const event of mainEvents) {
    for (const teamName of [event.home_team, event.away_team]) {
      const key = `${teamName}|${event.sport_key}`;
      if (!teamMap.has(key)) {
        teamMap.set(key, {
          name: teamName,
          sport: event.sport_key,
          league: event.sport_title,
          odds: [],
          nextMatch: `${event.home_team} vs ${event.away_team}`,
          nextTime: event.commence_time,
          bookmakerCount: 0,
        });
      }
      const team = teamMap.get(key)!;
      team.nextMatch = `${event.home_team} vs ${event.away_team}`;
      team.nextTime = event.commence_time;

      // Calcular probabilidad justa (vig-free) por bookmaker y promediar
      for (const bk of event.bookmakers) {
        const h2h = bk.markets?.find(m => m.key === 'h2h');
        if (!h2h?.outcomes || h2h.outcomes.length < 2) continue;
        const outcome = h2h.outcomes.find(o => o.name === teamName);
        if (!outcome) continue;
        // Vig removal: usar probabilidades justas en lugar de cuotas crudas
        const prices = h2h.outcomes.map(o => o.price);
        const fairProbs = removeVig(prices);
        const idx = h2h.outcomes.findIndex(o => o.name === teamName);
        if (idx >= 0) {
          // Convertir prob justa de vuelta a cuota equivalente
          team.odds.push(1 / fairProbs[idx]);
          team.bookmakerCount++;
        }
      }
    }
  }

  const teams = Array.from(teamMap.values())
    .filter(t => t.odds.length >= 2)
    .map(t => {
      const avgOdds = t.odds.reduce((s, o) => s + o, 0) / t.odds.length;
      const fairProb = 1 / avgOdds;
      return { ...t, avgOdds, fairProb };
    })
    .sort((a, b) => b.fairProb - a.fairProb);

  // Group by sport
  const bySport = new Map<string, typeof teams>();
  for (const team of teams) {
    const sport = team.sport;
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport)!.push(team);
  }

  return (
    <div>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart3 size={24} color="var(--accent-gold)" />
          Equipos & Mercado
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Probabilidades justas (sin vig) del mercado para partidos próximos · {mainEvents.length} eventos activos
        </p>
      </header>

      {teams.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Activity size={44} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontWeight: 700, marginBottom: 6 }}>Sin equipos con datos suficientes</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem' }}>
            Se necesitan al menos 2 bookmakers por partido para calcular probabilidades justas.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {Array.from(bySport.entries()).map(([sport, sportTeams]) => {
            const { icon, color } = getSportMeta(sport);
            const sportLabel = sport.includes('soccer') ? 'Fútbol' : sport.includes('basketball') ? 'Básquetbol' : sport.includes('baseball') ? 'Béisbol' : sport;

            return (
              <div key={sport} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Sport header */}
                <div style={{
                  padding: '0.875rem 1.25rem',
                  background: `linear-gradient(90deg, ${color}12, transparent)`,
                  borderBottom: `1px solid ${color}20`,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: '1.2rem' }}>{icon}</span>
                  <h2 style={{ fontWeight: 700, fontSize: '1rem' }}>{sportLabel}</h2>
                  <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>
                    {sportTeams.length} equipos
                  </span>
                </div>

                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 3fr',
                  gap: '0.5rem',
                  padding: '0.5rem 1.25rem',
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  {['Equipo', 'Win Prob', 'Cuota justa', 'Libros', 'Próximo Partido'].map((h, i) => (
                    <div key={i} style={{ fontSize: '0.6rem', color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {h}
                    </div>
                  ))}
                </div>

                {/* Team rows */}
                {sportTeams.slice(0, 24).map((team, i) => {
                  const probPct = (team.fairProb * 100).toFixed(1);
                  const isFavorite = team.fairProb > 0.55;
                  const isUnderdog = team.fairProb < 0.38;
                  const probColor = isFavorite ? 'var(--accent-green)' : isUnderdog ? 'var(--accent-red)' : 'var(--foreground)';
                  const nextDate = new Date(team.nextTime).toLocaleDateString('es-CR', {
                    timeZone: 'America/Costa_Rica', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  });

                  return (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1fr 3fr',
                        gap: '0.5rem',
                        padding: '0.65rem 1.25rem',
                        borderBottom: i < sportTeams.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        alignItems: 'center',
                        transition: 'background 0.12s',
                      }}
                      className="value-bet-row"
                    >
                      {/* Team name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isFavorite && (
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: 'var(--accent-green)', flexShrink: 0,
                          }} />
                        )}
                        {isUnderdog && (
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: 'var(--accent-red)', flexShrink: 0,
                          }} />
                        )}
                        {!isFavorite && !isUnderdog && (
                          <span style={{ width: 6, height: 6, flexShrink: 0 }} />
                        )}
                        <span style={{ fontWeight: 600, fontSize: '0.87rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {team.name}
                        </span>
                      </div>

                      {/* Win prob */}
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: probColor }}>{probPct}%</div>
                        <div style={{ height: 2, background: 'var(--border)', borderRadius: 1, marginTop: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${team.fairProb * 100}%`, background: probColor, borderRadius: 1 }} />
                        </div>
                      </div>

                      {/* Fair odds */}
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--accent-gold)' }}>
                        {team.avgOdds.toFixed(2)}
                      </div>

                      {/* Bookmakers */}
                      <div style={{ fontSize: '0.82rem', color: 'var(--foreground-muted)' }}>
                        {team.bookmakerCount}
                      </div>

                      {/* Next match */}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {team.nextMatch}
                        </div>
                        <div style={{ fontSize: '0.63rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
                          {nextDate}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ fontSize: '0.7rem', color: 'var(--foreground-subtle)', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <span><span style={{ color: 'var(--accent-green)' }}>●</span> Favorito (&gt;55%)</span>
            <span><span style={{ color: 'var(--accent-red)' }}>●</span> Underdog (&lt;38%)</span>
            <span>Probabilidades calculadas sin vig (margen) del bookmaker</span>
          </div>
        </div>
      )}
    </div>
  );
}
