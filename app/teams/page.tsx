import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Users, Activity } from 'lucide-react';
import { getUpcomingMatches, categorizeEventsByTime, getSportMeta } from '@/lib/apis/odds-api';
import { isMainSport } from '@/lib/algorithms/value-bet-calculator';

export default async function TeamsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming } = categorizeEventsByTime(allEvents);

  // Solo deportes principales
  const mainEvents = upcoming.filter(e => isMainSport(e.sport_key));

  // Extraer equipos únicos con sus cuotas promedio
  const teamMap = new Map<string, {
    name: string;
    sport: string;
    league: string;
    avgOdds: number[];
    matchCount: number;
    nextMatch: string;
    nextTime: string;
  }>();

  for (const event of mainEvents) {
    for (const teamName of [event.home_team, event.away_team]) {
      if (!teamMap.has(teamName)) {
        teamMap.set(teamName, {
          name: teamName,
          sport: event.sport_key,
          league: event.sport_title,
          avgOdds: [],
          matchCount: 0,
          nextMatch: '',
          nextTime: event.commence_time,
        });
      }
      const team = teamMap.get(teamName)!;
      team.matchCount++;
      team.nextMatch = `${event.home_team} vs ${event.away_team}`;
      team.nextTime = event.commence_time;

      // Recopilar cuotas de H2H para este equipo
      for (const bk of event.bookmakers) {
        const h2h = bk.markets?.find(m => m.key === 'h2h');
        if (!h2h?.outcomes) continue;
        const outcome = h2h.outcomes.find(o => o.name === teamName);
        if (outcome) team.avgOdds.push(outcome.price);
      }
    }
  }

  const teams = Array.from(teamMap.values())
    .filter(t => t.avgOdds.length > 0)
    .map(t => ({
      ...t,
      impliedProb: t.avgOdds.reduce((s, o) => s + (1 / o), 0) / t.avgOdds.length,
      avgOddsValue: t.avgOdds.reduce((s, o) => s + o, 0) / t.avgOdds.length,
    }))
    .sort((a, b) => b.impliedProb - a.impliedProb); // Favoritos primero

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users size={26} color="var(--accent-gold)" />
          Equipos Próximos
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Equipos con partidos próximos · Probabilidad implícita del mercado · Solo ⚽🏀⚾
        </p>
      </header>

      {teams.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Activity size={44} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontWeight: 700, marginBottom: 4 }}>Sin equipos próximos</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem' }}>No hay partidos de fútbol, basket o béisbol pendientes ahora.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          {teams.slice(0, 20).map((team, i) => {
            const { icon, color } = getSportMeta(team.sport);
            const probPct = (team.impliedProb * 100).toFixed(0);
            const isFavorite = team.impliedProb > 0.5;
            return (
              <div key={i} className="card hover-border" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'center', marginBottom: '0.875rem' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: `${color}20`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.5rem',
                  }}>
                    {icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</h2>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>{team.league}</p>
                  </div>
                  {isFavorite && (
                    <span style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(0,214,143,0.12)', color: 'var(--accent-green)', fontSize: '0.65rem', fontWeight: 700 }}>
                      FAV
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.5rem', background: 'var(--background-secondary)', borderRadius: 8, marginBottom: 10 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>WIN PROB</div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: team.impliedProb > 0.5 ? 'var(--accent-green)' : 'var(--foreground)' }}>
                      {probPct}%
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>CUOTA MEDIA</div>
                    <div style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>{team.avgOddsValue.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>CASAS</div>
                    <div style={{ fontWeight: 700 }}>{team.avgOdds.length}</div>
                  </div>
                </div>

                {/* Next match */}
                <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                  Próximo: <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{team.nextMatch}</span>
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
                  {new Date(team.nextTime).toLocaleDateString('es', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
