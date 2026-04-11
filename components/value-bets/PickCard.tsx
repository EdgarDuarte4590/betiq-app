'use client';

import LocalTime from '@/components/LocalTime';
import { useBankrollStore } from '@/lib/store/bankrollStore';
import type { SmartPick } from '@/lib/algorithms/value-bet-calculator';
import { getSportMeta } from '@/lib/apis/odds-api';

export default function PickCard({ pick, isLive = false }: { pick: SmartPick; isLive?: boolean }) {
  const { openModal, bankroll } = useBankrollStore();

  const { icon } = getSportMeta(pick.sport);
  const realBankroll = bankroll > 0 ? bankroll : 1000;
  const suggestedStake = pick.kellyStake > 0 
    ? ((realBankroll * pick.kellyStake) / 100).toFixed(2) 
    : '50';

  const handleCardClick = () => {
    openModal({
      match: pick.event,
      odds: pick.bestOdds.toFixed(2),
      stake: suggestedStake,
      sport: icon,
      league: pick.league,
      pick: pick.bestPick,
    });
  };

  const confidenceColors = {
    alta:  { bg: 'rgba(0,214,143,0.12)', color: 'var(--accent-green)', label: '🔥 Alta' },
    media: { bg: 'rgba(255,215,0,0.12)', color: 'var(--accent-gold)', label: '⚡ Media' },
    baja:  { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', label: '📊 Baja' },
  };
  const conf = confidenceColors[pick.confidence];

  return (
    <div 
      className="card hover-border" 
      onClick={handleCardClick}
      style={{
        background: 'var(--background-secondary)',
        borderRadius: 10,
        padding: '1rem',
        border: '1px solid var(--border-subtle)',
        transition: 'border-color 0.2s, transform 0.15s',
        cursor: 'pointer',
      }}
    >
      {/* Top row: sport + league + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span>{icon}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>{pick.league}</span>
        <span style={{ fontSize: '0.68rem', color: 'var(--foreground-subtle)' }}>
          · <LocalTime isoString={pick.commenceTime} format="time" />
        </span>
        {pick.valuePercentage > 0 && !isLive && (
          <span style={{ marginLeft: 'auto', padding: '1px 8px', borderRadius: 99, background: conf.bg, color: conf.color, fontSize: '0.65rem', fontWeight: 700 }}>
            {conf.label}
          </span>
        )}
        {isLive && (
          <span style={{ marginLeft: 'auto', padding: '1px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', fontSize: '0.65rem', fontWeight: 800, animation: 'pulse 2s infinite' }}>
            🔴 EN JUEGO
          </span>
        )}
      </div>

      {/* Match name */}
      <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 6 }}>{pick.event}</div>

      {/* The pick (analyst recommendation) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.82rem', color: 'var(--accent-green)', fontWeight: 600 }}>
            → {pick.bestPick}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
            {pick.bestMarket} · {pick.bookmakerCount} casas
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: pick.valuePercentage > 0 ? 'var(--accent-gold)' : 'var(--foreground)' }}>
            {pick.oddsRange}
          </div>
          {pick.valuePercentage > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--accent-green)', fontWeight: 700, marginTop: 2 }}>
              +{pick.valuePercentage.toFixed(1)}% valor
            </div>
          )}
        </div>
      </div>

      {/* Value bar */}
      {pick.valuePercentage > 0 && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1, height: 3, borderRadius: 2,
            background: 'var(--border)', overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(pick.valuePercentage * 8, 100)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent-green), var(--accent-gold))',
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--foreground-muted)' }}>
            Kelly: {pick.kellyStake.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
