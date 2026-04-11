'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(loginError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at center, #111827 0%, #0a0d14 100%)',
      padding: '1rem'
    }}>
      <div className="card animate-fade-in" style={{
        width: '100%',
        maxWidth: '400px',
        padding: '2.5rem',
        background: 'rgba(20, 27, 45, 0.4)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            Bet<span className="gradient-text">IQ</span>
          </h1>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.9rem' }}>
            Inicia sesión para gestionar tu bankroll
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--accent-red)',
            padding: '0.75rem',
            borderRadius: '8px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1.5rem'
          }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--foreground-muted)', marginBottom: '0.5rem' }}>Correo Electrónico</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-subtle)' }} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem 0.8rem 2.8rem',
                  borderRadius: '10px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                className="focus:border-accent-green"
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--foreground-muted)', marginBottom: '0.5rem' }}>Contraseña</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-subtle)' }} />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem 0.8rem 2.8rem',
                  borderRadius: '10px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  fontSize: '0.95rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '0.85rem',
              marginTop: '0.5rem',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Iniciando...' : <><LogIn size={18} /> Entrar</>}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.9rem' }}>
          <span style={{ color: 'var(--foreground-muted)' }}>¿No tienes cuenta? </span>
          <Link href="/register" style={{ color: 'var(--accent-green)', fontWeight: 600, textDecoration: 'none' }}>
            Regístrate aquí
          </Link>
        </div>
      </div>
    </div>
  );
}
