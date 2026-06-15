'use client';

import { useEffect } from 'react';
import { useBankrollStore } from '@/lib/store/bankrollStore';
import { DollarSign, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import Link from 'next/link';

interface BankrollWidgetProps {
  bankrollActual?: number;
  bankrollInicial?: number;
}

export default function BankrollWidget({ bankrollActual, bankrollInicial }: BankrollWidgetProps = {}) {
  const { bankroll, openModal, syncWithSupabase } = useBankrollStore();

  useEffect(() => {
    syncWithSupabase();
  }, []); // eslint-disable-line

  // Prefer server-side values if provided, fallback to store
  const currentBankroll = bankrollActual ?? bankroll;
  const initialBankroll = bankrollInicial ?? 1000;
  const change = currentBankroll - initialBankroll;
  const changePct = initialBankroll > 0 ? ((change / initialBankroll) * 100) : 0;
  const isPositive = change >= 0;

  return (
    <div className="card" style={{
      background: 'linear-gradient(135deg, rgba(0,214,143,0.07) 0%, rgba(255,215,0,0.03) 60%, var(--background-card) 100%)',
      border: '1px solid rgba(0,214,143,0.15)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
          <DollarSign size={13} />
          Bankroll Disponible
        </div>
        {isPositive
          ? <TrendingUp size={15} color="var(--accent-green)" />
          : <TrendingDown size={15} color="var(--accent-red)" />
        }
      </div>

      <div style={{ fontSize: '2.1rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
        ${currentBankroll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{
          fontSize: '0.72rem', fontWeight: 700, padding: '2px 7px', borderRadius: 6,
          background: isPositive ? 'rgba(0,214,143,0.12)' : 'rgba(239,68,68,0.12)',
          color: isPositive ? 'var(--accent-green)' : 'var(--accent-red)',
        }}>
          {isPositive ? '+' : ''}{change.toFixed(2)} ({changePct > 0 ? '+' : ''}{changePct.toFixed(1)}%)
        </span>
        <span style={{ fontSize: '0.67rem', color: 'var(--foreground-subtle)' }}>vs inicio ${initialBankroll.toLocaleString('en-US')}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={() => openModal()}
          className="btn-primary"
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '0.55rem 0' }}
        >
          <Plus size={14} /> Registrar Apuesta
        </button>
        <Link href="/bankroll" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0.55rem 0.875rem', borderRadius: 8,
          border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--foreground-muted)', fontSize: '0.75rem', fontWeight: 600,
          textDecoration: 'none', transition: 'border-color 0.15s, color 0.15s',
          whiteSpace: 'nowrap',
        }}>
          Ver más
        </Link>
      </div>
    </div>
  );
}
