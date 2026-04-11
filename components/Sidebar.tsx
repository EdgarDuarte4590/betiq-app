'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  DollarSign,
  Star,
  Activity,
  Zap,
  LogOut,
  User,
} from 'lucide-react';
import { useBankrollStore } from '@/lib/store/bankrollStore';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/value-bets', label: 'Value Bets', icon: Zap },
  { href: '/teams', label: 'Equipos', icon: BarChart3 },
  { href: '/trends', label: 'Tendencias', icon: TrendingUp },
  { href: '/bankroll', label: 'Bankroll', icon: DollarSign },
  { href: '/picks', label: 'Picks', icon: Star },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useBankrollStore();

  // No mostrar la barra lateral en las páginas de login / registro
  const isAuthPage = pathname === '/login' || pathname === '/register';
  if (isAuthPage) return null;

  return (
    <aside style={{
      width: 'var(--sidebar-width)',
      minHeight: '100vh',
      background: 'var(--background-card)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent-green), var(--accent-gold))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Activity size={20} color="#0a0d14" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}
              className="gradient-text">
              BetIQ
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--foreground-muted)', letterSpacing: '0.1em' }}>
              ANALYTICS
            </div>
          </div>
        </div>
      </div>

      {/* Live indicator */}
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--accent-green)',
          }} className="animate-pulse-green" />
          <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>EN VIVO</span>
          <span style={{ color: 'var(--foreground-muted)' }}>· Odds actualizando</span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link key={href} href={href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0.625rem 0.875rem',
              borderRadius: 8,
              textDecoration: 'none',
              transition: 'all 0.15s',
              background: isActive ? 'rgba(0,214,143,0.1)' : 'transparent',
              color: isActive ? 'var(--accent-green)' : 'var(--foreground-muted)',
              borderLeft: isActive ? '2px solid var(--accent-green)' : '2px solid transparent',
              fontWeight: isActive ? 600 : 400,
              fontSize: '0.9rem',
            }}>
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Profile & Logout */}
      <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <User size={16} color="var(--accent-gold)" />
          </div>
          <div style={{ overflow: 'hidden' }}>
             <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
               {user?.email || 'Usuario'}
             </div>
             <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>Cuenta Pro</div>
          </div>
        </div>
        <button 
          onClick={() => logout()}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '0.5rem',
            borderRadius: 6,
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--accent-red)',
            border: 'none',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <LogOut size={14} /> Salir
        </button>
      </div>
    </aside>
  );
}
