'use client';

import LocalTime from '@/components/LocalTime';
import { useBankrollStore } from '@/lib/store/bankrollStore';
import type { SmartPick } from '@/lib/algorithms/value-bet-calculator';
import { getSportMeta } from '@/lib/apis/odds-api';
import { ShieldCheck, AlertTriangle, Eye, TrendingUp } from 'lucide-react';

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
      market: pick.bestMarket,
      matchTime: pick.commenceTime,
      sportKey: pick.sport,
      confidence: pick.confidence,
    });
  };

  const confidenceConfig = {
    alta:  {
      bg: 'rgba(0,214,143,0.12)',
      border: 'rgba(0,214,143,0.25)',
      color: 'var(--accent-green)',
      label: '🔥 Alta',
      icon: ShieldCheck,
    },
    media: {
      bg: 'rgba(255,215,0,0.10)',
      border: 'rgba(255,215,0,0.2)',
      color: 'var(--accent-gold)',
      label: '⚡ Media',
      icon: TrendingUp,
    },
    baja:  {
      bg: 'rgba(148,163,184,0.08)',
      border: 'rgba(148,163,184,0.15)',
      color: '#94a3b8',
      label: '📊 Baja',
      icon: AlertTriangle,
    },
  };
  const conf = confidenceConfig[pick.confidence];

  // Build explanation text
  const explanationParts: string[] = [];
  if (pick.pinnacleAligns) {
    explanationParts.push('📌 Pinnacle/sharp respaldando');
  }
  if (pick.consensusStrength >= 0.75) {
    explanationParts.push(`${Math.round(pick.consensusStrength * 100)}% de libros de acuerdo`);
  } else if (pick.consensusStrength >= 0.5) {
    explanationParts.push(`${Math.round(pick.consensusStrength * 100)}% consenso`);
  }
  if (pick.bookmakerCount >= 5) {
    explanationParts.push(`${pick.bookmakerCount} casas verificadas`);
  }
  const fairProbPct = (pick.marketProbability * 100).toFixed(0);

  const cardBorder = isLive
    ? 'rgba(239,68,68,0.35)'
    : pick.isFallback
      ? 'var(--border-subtle)'
      : pick.confidence === 'alta'
        ? 'rgba(0,214,143,0.2)'
        : 'var(--border-subtle)';

  return (
    <div
      className="pick-card"
      onClick={handleCardClick}
      style={{
        background: pick.confidence === 'alta' && !pick.isFallback
          ? 'linear-gradient(135deg, rgba(0,214,143,0.04) 0%, var(--background-secondary) 40px)'
          : 'var(--background-secondary)',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        border: `1px solid ${cardBorder}`,
        transition: 'border-color 0.2s, transform 0.15s, box-shadow 0.2s',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Accent line on left for high confidence */}
      {pick.confidence === 'alta' && !pick.isFallback && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: 'linear-gradient(180deg, var(--accent-green), var(--accent-gold))',
          borderRadius: '12px 0 0 12px',
        }} />
      )}

      {/* Top row: sport + league + time + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap', paddingLeft: pick.confidence === 'alta' && !pick.isFallback ? 6 : 0 }}>
        <span style={{ fontSize: '1rem' }}>{icon}</span>
        <span style={{ fontSize: '0.70rem', color: 'var(--foreground-muted)', fontWeight: 500 }}>{pick.league}</span>
        <span style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)' }}>
          · <LocalTime isoString={pick.commenceTime} format="datetime" />
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          {pick.pinnacleAligns && !pick.isFallback && (
            <span title="Sharp books respaldan este pick" style={{
              padding: '1px 6px', borderRadius: 99,
              background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)',
              fontSize: '0.6rem', fontWeight: 700,
            }}>📌 SHARP</span>
          )}
          {!pick.isFallback && !isLive && (
            <span style={{
              padding: '2px 9px', borderRadius: 99,
              background: conf.bg, color: conf.color,
              fontSize: '0.65rem', fontWeight: 700,
              border: `1px solid ${conf.border}`,
            }}>
              {conf.label}
            </span>
          )}
          {pick.isFallback && !isLive && (
            <span title="Sin edge matemático detectado. Monitorear." style={{
              padding: '2px 9px', borderRadius: 99,
              background: 'rgba(100,116,139,0.12)', color: '#64748b',
              fontSize: '0.65rem', fontWeight: 600,
              border: '1px solid rgba(100,116,139,0.2)',
            }}>
              <Eye size={9} style={{ display: 'inline', marginRight: 3 }} />
              Sin edge · Monitorear
            </span>
          )}
          {isLive && (
            <span style={{
              padding: '2px 9px', borderRadius: 99,
              background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)',
              fontSize: '0.65rem', fontWeight: 800,
              animation: 'pulse 2s infinite',
              border: '1px solid rgba(239,68,68,0.3)',
            }}>
              🔴 EN JUEGO
            </span>
          )}
        </div>
      </div>

      {/* Match name */}
      <div style={{
        fontWeight: 700, fontSize: '0.92rem', marginBottom: 8,
        paddingLeft: pick.confidence === 'alta' && !pick.isFallback ? 6 : 0,
      }}>
        {pick.event}
      </div>

      {/* Pick recommendation + odds */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        paddingLeft: pick.confidence === 'alta' && !pick.isFallback ? 6 : 0,
      }}>
        <div>
          <div style={{
            fontSize: '0.85rem',
            color: pick.isFallback ? 'var(--foreground-muted)' : 'var(--accent-green)',
            fontWeight: 700,
            letterSpacing: '0.01em',
          }}>
            → {pick.bestPick}
          </div>
          <div style={{ fontSize: '0.67rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
            {pick.bestMarket} · {pick.bookmakerCount} {pick.bookmakerCount === 1 ? 'casa' : 'casas'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: '1.4rem', fontWeight: 800, lineHeight: 1,
            color: pick.valuePercentage > 0 ? 'var(--accent-gold)' : 'var(--foreground-muted)',
          }}>
            {pick.oddsRange}
          </div>
          {pick.valuePercentage > 0 && (
            <div style={{ fontSize: '0.72rem', color: 'var(--accent-green)', fontWeight: 700, marginTop: 3 }}>
              +{pick.valuePercentage.toFixed(1)}% valor esperado
            </div>
          )}
        </div>
      </div>

      {/* Explanation panel — only for picks with real value */}
      {pick.valuePercentage > 0 && (
        <div style={{
          marginTop: 10,
          padding: '0.5rem 0.65rem',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 8,
          borderLeft: `2px solid ${conf.color}30`,
        }}>
          {/* Value bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: explanationParts.length > 0 ? 6 : 0 }}>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(pick.valuePercentage * 7, 100)}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${conf.color}, var(--accent-gold))`,
                borderRadius: 2,
                transition: 'width 0.6s ease',
              }} />
            </div>
            <span style={{ fontSize: '0.67rem', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }}>
              Kelly: {pick.kellyStake.toFixed(1)}% · Prob. justa: {fairProbPct}%
            </span>
          </div>

          {/* Why this pick */}
          {explanationParts.length > 0 && (
            <div style={{ fontSize: '0.68rem', color: 'var(--foreground-muted)', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {explanationParts.map((part, i) => (
                <span key={i} style={{
                  padding: '1px 7px', borderRadius: 99,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  {part}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fallback explanation */}
      {pick.isFallback && (
        <div style={{
          marginTop: 8, fontSize: '0.68rem',
          color: 'var(--foreground-subtle)',
          fontStyle: 'italic',
          paddingLeft: 4,
        }}>
          ⚠ Sin ventaja matemática detectada en este partido. Solo se muestra como referencia.
        </div>
      )}
    </div>
  );
}
