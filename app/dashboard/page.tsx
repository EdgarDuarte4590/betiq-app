import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Zap, DollarSign, Target, TrendingUp, Activity, Clock } from 'lucide-react';
import { getUpcomingMatches, categorizeEventsByTime, getSportMeta } from '@/lib/apis/odds-api';
import { extractValueBets, calculateBettingStats } from '@/lib/algorithms/value-bet-calculator';
import LocalTime from '@/components/LocalTime';
import BankrollWidget from '@/components/bankroll/BankrollWidget';
import PickCard from '@/components/value-bets/PickCard';

export default async function DashboardPage() {
  // ── Auth & User Data ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ── Profile & Stats from Supabase ─────────────────────────────────────────
  const [profileResult, betsResult] = await Promise.all([
    supabase.from('profiles').select('bankroll_actual, bankroll_inicial').eq('id', user.id).single(),
    supabase.from('bets').select('status, stake, odds, profit, created_at').eq('user_id', user.id),
  ]);

  const profile = profileResult.data;
  const allBets = betsResult.data ?? [];

  // Calcular estadísticas de esta semana
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const weekBets = allBets.filter(b => new Date(b.created_at) > oneWeekAgo);

  const totalStats = calculateBettingStats(allBets.map(b => ({
    status: b.status,
    stake: parseFloat(b.stake ?? '0'),
    odds: parseFloat(b.odds ?? '0'),
    profit: parseFloat(b.profit ?? '0'),
  })));

  const weekStats = calculateBettingStats(weekBets.map(b => ({
    status: b.status,
    stake: parseFloat(b.stake ?? '0'),
    odds: parseFloat(b.odds ?? '0'),
    profit: parseFloat(b.profit ?? '0'),
  })));

  const bankrollActual = parseFloat(profile?.bankroll_actual ?? '1000');
  const bankrollInicial = parseFloat(profile?.bankroll_inicial ?? '1000');
  const bankrollChange = bankrollActual - bankrollInicial;

  // ── API Data & Value Engine ───────────────────────────────────────────────
  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming, possiblyLive } = categorizeEventsByTime(allEvents);

  // Top picks: los próximos 5 partidos con sus cuotas
  const displayUpcoming = upcoming.slice(0, 5);
  const displayLater = upcoming.slice(5, 10);

  // Value bets reales del motor
  const topValueBets = extractValueBets(upcoming, 2.0).slice(0, 3);

  // Transformar eventos en picks para los PickCards
  function eventToPick(event: typeof upcoming[0]) {
    const { icon } = getSportMeta(event.sport_key);
    const bookmaker = event.bookmakers?.find(b => b.key === 'bet365') || event.bookmakers?.[0];
    const h2h = bookmaker?.markets?.find(m => m.key === 'h2h');
    const homeOutcome = h2h?.outcomes?.find(o => o.name === event.home_team);
    const homeWinOdds = homeOutcome?.price ?? 0;

    return {
      sport: icon,
      league: event.sport_title,
      match: `${event.home_team} vs ${event.away_team}`,
      pick: `Gana ${event.home_team}`,
      odds: homeWinOdds ? homeWinOdds.toFixed(2) : '-',
      bookmakerName: bookmaker?.title || 'N/A',
      timeISO: event.commence_time,
      hasValue: false,
      valuePercentage: 0,
      kellyStake: 0,
      realWinPercentage: 0,
    };
  }

  const realPicks = displayUpcoming.map(eventToPick);
  const laterPicks = displayLater.map(eventToPick);

  // ── Stat Cards ────────────────────────────────────────────────────────────
  const statsData = [
    {
      label: 'Bankroll Actual',
      value: `$${bankrollActual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: bankrollChange >= 0 ? `+$${bankrollChange.toFixed(2)} vs inicial` : `-$${Math.abs(bankrollChange).toFixed(2)} vs inicial`,
      positive: bankrollChange >= 0,
      icon: DollarSign,
      color: 'var(--accent-green)',
    },
    {
      label: 'Value Bets Hoy',
      value: String(topValueBets.length),
      change: `De ${upcoming.length} partidos próximos`,
      positive: true,
      icon: Zap,
      color: 'var(--accent-gold)',
    },
    {
      label: 'ROI Total',
      value: `${totalStats.roi >= 0 ? '+' : ''}${totalStats.roi.toFixed(1)}%`,
      change: totalStats.total > 0 ? `${totalStats.total} apuestas cerradas` : 'Empieza a apostar',
      positive: totalStats.roi >= 0,
      icon: TrendingUp,
      color: 'var(--accent-blue)',
    },
    {
      label: 'Win Rate',
      value: totalStats.winRate > 0 ? `${totalStats.winRate.toFixed(0)}%` : '-%',
      change: `${totalStats.won}V / ${totalStats.lost}D`,
      positive: totalStats.winRate >= 50,
      icon: Target,
      color: '#a855f7',
    },
  ];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)' }}>
            <LocalTime format="date" />
          </span>
          {possiblyLive.length > 0 && (
            <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
              {possiblyLive.length} EN VIVO
            </span>
          )}
        </div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
          Dashboard <span className="gradient-text">BetIQ</span>
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: 4, fontSize: '0.9rem' }}>
          Bienvenido · {user.email}
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {statsData.map(({ label, value, change, icon: Icon, color, positive }, i) => (
          <div key={i} className="stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ color: 'var(--foreground-muted)', fontSize: '0.8rem', fontWeight: 500 }}>{label}</span>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} color={color} />
              </div>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 4 }}>{value}</div>
            <div style={{ fontSize: '0.75rem', color: positive ? 'var(--accent-green)' : 'var(--accent-red)' }}>{change}</div>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>

        {/* Left: Matches */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Top Picks */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={16} color="var(--accent-green)" />
                Próximos Partidos
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                Clic para apostar
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {realPicks.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '0.9rem' }}>
                  Sin partidos próximos disponibles. El caché se actualiza cada hora.
                </div>
              ) : realPicks.map((pick, i) => (
                <PickCard key={`live-${i}`} pick={pick} />
              ))}
            </div>
          </div>

          {/* Para Más Tarde */}
          {laterPicks.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h2 style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={16} color="var(--foreground-muted)" />
                  Para Más Tarde
                </h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                  Próximas{' '}
                  {new Date(laterPicks[0].timeISO).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}+
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {laterPicks.map((pick, i) => (
                  <PickCard key={`later-${i}`} pick={pick} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <BankrollWidget />

          {/* Value Bets Reales */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={16} color="var(--accent-gold)" />
              Top Value Bets
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topValueBets.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)', textAlign: 'center', padding: '1rem' }}>
                  El motor no detectó valor ahora mismo.
                </p>
              ) : topValueBets.map((vb, i) => (
                <div key={i} style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(0,214,143,0.07)', border: '1px solid rgba(0,214,143,0.15)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                      ⚡ +{vb.valuePercentage.toFixed(1)}% valor
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>{vb.bookmaker}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{vb.event}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--foreground-muted)', marginTop: 2 }}>
                    {vb.pick} · Cuota {vb.odds.toFixed(2)} · Kelly {vb.kellyStake.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Esta Semana (real) */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem' }}>📈 Esta Semana</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: 'Apuestas', value: String(weekStats.total) },
                { label: 'Ganadas', value: String(weekStats.won), color: weekStats.won > 0 ? 'var(--accent-green)' : undefined },
                { label: 'Perdidas', value: String(weekStats.lost), color: weekStats.lost > 0 ? 'var(--accent-red)' : undefined },
                {
                  label: 'Profit',
                  value: weekStats.totalProfit >= 0 ? `+$${weekStats.totalProfit.toFixed(2)}` : `-$${Math.abs(weekStats.totalProfit).toFixed(2)}`,
                  color: weekStats.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                },
              ].map(({ label, value, color }, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>{label}</span>
                  <span style={{ fontWeight: 700, color: color ?? 'var(--foreground)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
