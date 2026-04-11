'use client';

import LocalTime from '@/components/LocalTime';
import { useBankrollStore } from '@/lib/store/bankrollStore';

interface PickProps {
  pick: {
    sport: string;
    league: string;
    match: string;
    pick: string;
    odds: string;
    bookmakerName: string;
    timeISO: string;
    hasValue: boolean;
    valuePercentage: number;
    kellyStake: number;
    realWinPercentage: number;
  }
}

export default function PickCard({ pick }: PickProps) {
  const { openModal } = useBankrollStore();

  const handleCardClick = () => {
    // Cuando el usuario hace clic en el partido, abrimos el modal de Registrar Apuesta
    // inyectándole los datos dinámicamente:
    openModal({
      match: pick.match,
      odds: pick.odds,
      stake: pick.kellyStake > 0 ? ((1000 * pick.kellyStake) / 100).toFixed(2) : '50', // Por ahora asume 1000 de bankroll inicial
      sport: pick.sport,
      league: pick.league,
      pick: pick.pick
    });
  };

  return (
    <div 
      className="card hover-border" 
      onClick={handleCardClick}
      style={{
        background: 'var(--background-secondary)',
        borderRadius: 10,
        padding: '1rem',
        border: '1px solid var(--border-subtle)',
        transition: 'border-color 0.2s',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span>{pick.sport}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>{pick.league}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--foreground-subtle)' }}>
              · <LocalTime isoString={pick.timeISO} format="time" />
            </span>
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>{pick.match}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--accent-green)' }}>→ {pick.pick}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: pick.hasValue ? 'var(--accent-gold)' : 'var(--foreground)' }}>
            {pick.odds}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>{pick.bookmakerName}</div>
          {pick.hasValue && (
            <div style={{ marginTop: 4 }}>
              <span style={{ color: 'var(--accent-gold)', fontSize: '0.7rem' }}>⭐</span>
              {pick.valuePercentage > 10 && <span style={{ color: 'var(--accent-gold)', fontSize: '0.7rem' }}>⭐</span>}
            </div>
          )}
        </div>
      </div>

      {pick.hasValue && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1, height: 4, borderRadius: 2,
            background: 'var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(pick.valuePercentage * 10, 100)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent-green), var(--accent-gold))',
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)', fontWeight: 700 }}>
            +{pick.valuePercentage.toFixed(1)}% Valor
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--foreground)', marginLeft: 6, fontWeight: 500 }}>
            Sugerido: {pick.kellyStake.toFixed(1)}% ({pick.realWinPercentage.toFixed(0)}% vR)
          </span>
        </div>
      )}
    </div>
  );
}
