'use client';

import { usePathname } from 'next/navigation';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/register';

  return (
    <main style={{
      marginLeft: isAuthPage ? 0 : 'var(--sidebar-width)',
      flex: 1,
      padding: isAuthPage ? 0 : '2rem',
      minHeight: '100vh',
    }}>
      {children}
    </main>
  );
}
