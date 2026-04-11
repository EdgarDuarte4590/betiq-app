import { Users, Search, ShieldHalf } from 'lucide-react';

export default function TeamsPage() {
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Users size={28} color="var(--accent-gold)" />
            Equipos y Análisis
          </h1>
          <p style={{ color: 'var(--foreground-muted)', marginTop: '0.5rem' }}>
            Base de datos estadísticos de equipos, jugadores y rentabilidad histórica.
          </p>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={18} color="var(--foreground-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            type="text" 
            placeholder="Buscar equipo o jugador..." 
            style={{ padding: '0.75rem 1rem 0.75rem 2.5rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', width: 300, color: 'var(--foreground)' }}
          />
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        <div className="card hover-border" style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <ShieldHalf size={32} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Real Madrid CF</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)' }}>Fútbol · La Liga</p>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--background-secondary)', borderRadius: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Win Rate</div>
              <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>78%</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>xG Total</div>
              <div style={{ fontWeight: 700 }}>45.2</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Forma</div>
              <div style={{ fontWeight: 700, display: 'flex', gap: 4 }}>
                <span style={{ color: 'var(--accent-green)' }}>W</span>
                <span style={{ color: 'var(--accent-green)' }}>W</span>
                <span style={{ color: 'var(--foreground-muted)' }}>D</span>
                <span style={{ color: 'var(--accent-green)' }}>W</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card hover-border" style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <ShieldHalf size={32} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Boston Celtics</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)' }}>Baloncesto · NBA</p>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--background-secondary)', borderRadius: 8 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Win Rate</div>
              <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>82%</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>PTS/G</div>
              <div style={{ fontWeight: 700 }}>120.4</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', textTransform: 'uppercase' }}>Forma</div>
              <div style={{ fontWeight: 700, display: 'flex', gap: 4 }}>
                <span style={{ color: 'var(--accent-green)' }}>W</span>
                <span style={{ color: 'red' }}>L</span>
                <span style={{ color: 'var(--accent-green)' }}>W</span>
                <span style={{ color: 'var(--accent-green)' }}>W</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
