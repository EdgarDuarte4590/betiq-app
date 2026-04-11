'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Zap,
  BarChart3,
  TrendingUp,
  DollarSign,
  Star,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/value-bets', label: 'Value Bets', icon: Zap },
  { href: '/picks', label: 'Picks', icon: Star },
  { href: '/trends', label: 'Trends', icon: TrendingUp },
  { href: '/bankroll', label: 'Bankroll', icon: DollarSign },
];

export default function BottomNav() {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/register';
  if (isAuthPage) return null;

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 200,
      background: 'rgba(10, 13, 20, 0.95)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-around',
      padding: '0.5rem 0 calc(0.5rem + env(safe-area-inset-bottom))',
    }}
    // Only visible on mobile – hidden via CSS
    className="bottom-nav"
    >
      {navItems.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link key={href} href={href} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            padding: '0.35rem 0.75rem',
            borderRadius: 10,
            textDecoration: 'none',
            color: isActive ? 'var(--accent-green)' : 'var(--foreground-muted)',
            transition: 'color 0.15s',
            minWidth: 52,
          }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isActive ? 'rgba(0,214,143,0.12)' : 'transparent',
              transition: 'background 0.15s',
            }}>
              <Icon size={20} />
            </div>
            <span style={{
              fontSize: '0.6rem',
              fontWeight: isActive ? 700 : 400,
              letterSpacing: '0.02em',
            }}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
