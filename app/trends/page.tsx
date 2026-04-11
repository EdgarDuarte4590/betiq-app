import { TrendingUp, BarChart2 } from 'lucide-react';

export default function TrendsPage() {
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <TrendingUp size={28} color="var(--accent-gold)" />
          Tendencias y Gráficas
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.5rem' }}>
          Análisis de tendencias del mercado y patrones de over/under.
        </p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        <div className="card" style={{ height: 400, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px dashed var(--border)' }}>
          <BarChart2 size={48} color="var(--border)" style={{ marginBottom: '1rem' }} />
          <h3 style={{ color: 'var(--foreground)', fontSize: '1.2rem', fontWeight: 600 }}>Gráficas de Tendencias Globales</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.9rem', maxWidth: 400, textAlign: 'center', marginTop: 8 }}>
            Aquí se integrará Recharts.js para mostrar tendencias de goles, puntos y rachas de los equipos principales.
          </p>
        </div>

      </div>
    </div>
  );
}
