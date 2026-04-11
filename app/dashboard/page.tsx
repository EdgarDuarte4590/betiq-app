import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Zap, DollarSign, Target, TrendingUp, Activity, Clock } from 'lucide-react';
import { getUpcomingMatches, categorizeEventsByTime } from '@/lib/apis/odds-api';
import { extractValueBets, getSmartPicks, calculateBettingStats } from '@/lib/algorithms/value-bet-calculator';
import LocalTime from '@/components/LocalTime';
import BankrollWidget from '@/components/bankroll/BankrollWidget';
import PickCard from '@/components/value-bets/PickCard';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ── Data from Supabase ─────
  const [profileResult, betsResult] = await Promise.all([
    supabase.from('profiles').select('bankroll_actual, bankroll_inicial').eq('id', user.id).single(),
    supabase.from('bets').select('status, stake, odds, profit, created_at').eq('user_id', user.id),
  ]);

  const profile = profileResult.data;
  const allBets = betsResult.data ?? [];

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const weekBets = allBets.filter(b => new Date(b.created_at) > oneWeekAgo);

  const totalStats = calculateBettingStats(allBets.map(b => ({
    status: b.status, stake: parseFloat(b.stake ?? '0'),
    odds: parseFloat(b.odds ?? '0'), profit: parseFloat(b.profit ?? '0'),
  })));
  const weekStats = calculateBettingStats(weekBets.map(b => ({
    status: b.status, stake: parseFloat(b.stake ?? '0'),
    odds: parseFloat(b.odds ?? '0'), profit: parseFloat(b.profit ?? '0'),
  })));

  const bankrollActual = parseFloat(profile?.bankroll_actual ?? '1000');
  const bankrollInicial = parseFloat(profile?.bankroll_inicial ?? '1000');
  const bankrollChange = bankrollActual - bankrollInicial;

  // ── API + Smart Engine ─────
  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming, possiblyLive } = categorizeEventsByTime(allEvents);

  // Smart picks: la mejor recomendación por partido (el analista elige)
  const smartPicks = getSmartPicks(upcoming, true);
  const displayUpcoming = smartPicks.slice(0, 5);
  const displayLater = smartPicks.slice(5, 10);

  // Value bets: top 3 para sidebar
  const topValueBets = extractValueBets(upcoming, 2.0, true).slice(0, 3);

  // ── Stat Cards ─────
  const statsData = [
    {
      label: 'Bankroll', icon: DollarSign, color: 'var(--accent-green)',
      value: `$${bankrollActual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      change: bankrollChange >= 0 ? `+$${bankrollChange.toFixed(2)} vs inicial` : `-$${Math.abs(bankrollChange).toFixed(2)} vs inicial`,
      positive: bankrollChange >= 0,
    },
    {
      label: 'Value Bets', icon: Zap, color: 'var(--accent-gold)',
      value: String(topValueBets.length),
      change: `De ${upcoming.length} partidos`,
      positive: true,
    },
    {
      label: 'ROI Total', icon: TrendingUp, color: 'var(--accent-blue)',
      value: `${totalStats.roi >= 0 ? '+' : ''}${totalStats.roi.toFixed(1)}%`,
      change: totalStats.total > 0 ? `${totalStats.total} apuestas` : 'Sin apuestas aún',
      positive: totalStats.roi >= 0,
    },
    {
      label: 'Win Rate', icon: Target, color: '#a855f7',
      value: totalStats.winRate > 0 ? `${totalStats.winRate.toFixed(0)}%` : '-%',
      change: `${totalStats.won}V / ${totalStats.lost}D`,
      positive: totalStats.winRate >= 50,
    },
  ];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
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
        <p style={{ color: 'var(--foreground-muted)', marginTop: 4, fontSize: '0.85rem' }}>
          Bienvenido · {user.email}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {statsData.map(({ label, value, change, icon: Icon, color, positive }, i) => (
          <div key={i} className="stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ color: 'var(--foreground-muted)', fontSize: '0.75rem', fontWeight: 500 }}>{label}</span>
              <div style={{ width: 30, height: 30, borderRadius: 7, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={14} color={color} />
              </div>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 3 }}>{value}</div>
            <div style={{ fontSize: '0.7rem', color: positive ? 'var(--accent-green)' : 'var(--accent-red)' }}>{change}</div>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left: Smart Picks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={16} color="var(--accent-green)" />
                Recomendaciones
              </h2>
              <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>
                ⚽🏀⚾ Clic para apostar
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {displayUpcoming.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--foreground-muted)', fontSize: '0.85rem' }}>
                  Sin partidos de fútbol, basket o béisbol próximos. Se actualiza cada hora.
                </div>
              ) : displayUpcoming.map((pick, i) => (
                <PickCard key={`up-${i}`} pick={pick} />
              ))}
            </div>
          </div>

          {displayLater.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={16} color="var(--foreground-muted)" />
                  Para Más Tarde
                </h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {displayLater.map((pick, i) => (
                  <PickCard key={`later-${i}`} pick={pick} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <BankrollWidget />

          {/* Top Value Bets */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={15} color="var(--accent-gold)" />
              Top Value Bets
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {topValueBets.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-muted)', textAlign: 'center', padding: '0.75rem' }}>
                  Sin oportunidades de valor en este momento.
                </p>
              ) : topValueBets.map((vb, i) => (
                <div key={i} style={{ padding: '0.65rem 0.75rem', borderRadius: 8, background: 'rgba(0,214,143,0.06)', border: '1px solid rgba(0,214,143,0.12)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                      ⚡ +{vb.valuePercentage.toFixed(1)}%
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--foreground-muted)' }}>{vb.market}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{vb.event}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)', marginTop: 2 }}>
                    {vb.pick} · {vb.oddsMin.toFixed(2)}–{vb.oddsMax.toFixed(2)} · Kelly {vb.kellyStake.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Esta Semana */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>📈 Esta Semana</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
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
