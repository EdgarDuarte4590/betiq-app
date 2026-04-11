'use client';

import { useEffect } from 'react';
import { useBankrollStore } from '@/lib/store/bankrollStore';
import { DollarSign, TrendingUp } from 'lucide-react';

export default function BankrollWidget() {
  const { bankroll, openModal, syncWithSupabase } = useBankrollStore();

  // Sincronizar con Supabase al montar
  useEffect(() => {
    syncWithSupabase();
  }, []); // eslint-disable-line

  return (
    <div className="card" style={{ background: 'linear-gradient(135deg, rgba(0,214,143,0.08), rgba(255,215,0,0.04))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <DollarSign size={13} /> Bankroll Disponible
        </div>
        <TrendingUp size={14} color="var(--accent-green)" />
      </div>
      <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
        ${bankroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </div>
      <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
        Referencia: $1,000.00
      </div>
      <button
        onClick={() => openModal()}
        className="btn-primary"
        style={{ width: '100%', justifyContent: 'center', fontSize: '0.82rem', marginTop: 14 }}
      >
        + Registrar Apuesta Libre
      </button>
    </div>
  );
}
