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
  ShieldCheck,
} from 'lucide-react';
import { useBankrollStore } from '@/lib/store/bankrollStore';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Picks del día' },
  { href: '/value-bets', label: 'Value Bets', icon: Zap, description: 'Scanner en vivo', badge: 'LIVE' },
  { href: '/teams', label: 'Equipos', icon: BarChart3, description: 'Stats por deporte' },
  { href: '/trends', label: 'Tendencias', icon: TrendingUp, description: 'Tu rendimiento' },
  { href: '/bankroll', label: 'Bankroll', icon: DollarSign, description: 'Gestión de capital' },
  { href: '/picks', label: 'Mis Picks', icon: Star, description: 'Historial' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, bankroll } = useBankrollStore();

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
      <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: 'linear-gradient(135deg, var(--accent-green), var(--accent-gold))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,214,143,0.3)',
          }}>
            <Activity size={20} color="#0a0d14" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}
              className="gradient-text">
              BetIQ
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Analytics Pro
            </div>
          </div>
        </div>

        {/* System status */}
        <div style={{
          marginTop: '0.875rem',
          padding: '0.5rem 0.75rem',
          background: 'rgba(0,214,143,0.06)',
          borderRadius: 8,
          border: '1px solid rgba(0,214,143,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.72rem',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--accent-green)',
            flexShrink: 0,
          }} className="animate-pulse-green" />
          <div>
            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Motor activo</span>
            <span style={{ color: 'var(--foreground-muted)' }}> · Odds actualizando</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '0.875rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(({ href, label, icon: Icon, description, badge }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link key={href} href={href} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '0.6rem 0.875rem',
              borderRadius: 9,
              textDecoration: 'none',
              transition: 'all 0.15s',
              background: isActive ? 'rgba(0,214,143,0.1)' : 'transparent',
              color: isActive ? 'var(--accent-green)' : 'var(--foreground-muted)',
              borderLeft: isActive ? '2px solid var(--accent-green)' : '2px solid transparent',
              fontWeight: isActive ? 600 : 400,
              fontSize: '0.875rem',
              position: 'relative',
            }}>
              <Icon size={17} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {label}
                  {badge && (
                    <span style={{
                      padding: '0px 5px', borderRadius: 4,
                      background: 'rgba(0,214,143,0.2)', color: 'var(--accent-green)',
                      fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.05em',
                    }}>
                      {badge}
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: '0.62rem',
                  color: isActive ? 'rgba(0,214,143,0.6)' : 'var(--foreground-subtle)',
                  marginTop: 1,
                }}>
                  {description}
                </div>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* How it works hint */}
      <div style={{
        margin: '0 0.75rem 0.75rem',
        padding: '0.75rem',
        background: 'rgba(59,130,246,0.06)',
        border: '1px solid rgba(59,130,246,0.15)',
        borderRadius: 9,
        fontSize: '0.68rem',
        color: 'var(--foreground-muted)',
        lineHeight: 1.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, fontWeight: 700, color: 'var(--accent-blue)' }}>
          <ShieldCheck size={11} /> Cómo funciona
        </div>
        El sistema calcula la probabilidad <em>justa</em> de cada partido usando 8+ bookmakers y detecta cuándo las cuotas ofrecen valor matemático real.
      </div>

      {/* Profile & Logout */}
      <div style={{ padding: '0.875rem', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.12)' }}>
        {user ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(0,214,143,0.2), rgba(255,215,0,0.15))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(0,214,143,0.2)',
              }}>
                <User size={15} color="var(--accent-green)" />
              </div>
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.email}
                </div>
                <div style={{ fontSize: '0.6rem', color: 'var(--accent-green)', fontWeight: 600 }}>
                  ${bankroll > 0 ? bankroll.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'} disponible
                </div>
              </div>
            </div>
            <button
              onClick={() => logout()}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                padding: '0.45rem',
                borderRadius: 7,
                background: 'rgba(239, 68, 68, 0.08)',
                color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.15)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              <LogOut size={13} /> Cerrar sesión
            </button>
          </>
        ) : (
          <Link href="/login" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 7, padding: '0.6rem', borderRadius: 8,
            background: 'linear-gradient(135deg, var(--accent-green), var(--accent-green-dark))',
            color: '#0a0d14', fontWeight: 700, fontSize: '0.82rem',
            textDecoration: 'none',
          }}>
            <User size={14} /> Iniciar sesión
          </Link>
        )}
      </div>
    </aside>
  );
}
