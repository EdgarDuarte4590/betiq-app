export default function PickCardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <>
      <style suppressHydrationWarning>{`
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
        .skeleton-shimmer {
          animation: shimmer 2s infinite linear;
          background: linear-gradient(to right, var(--background-secondary) 4%, var(--border-subtle) 25%, var(--background-secondary) 36%);
          background-size: 1000px 100%;
        }
      `}</style>
      
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card skeleton-shimmer" style={{
          height: 120, // Approx height of PickCard
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          marginBottom: '0.65rem',
        }}>
          {/* Skeleton internal layout to make it look nicer */}
          <div style={{ display: 'flex', flexDirection: 'column', padding: '1rem', height: '100%' }}>
            {/* Top row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
              <div style={{ width: 80, height: 16, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginTop: 4 }} />
              <div style={{ width: 60, height: 16, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginTop: 4, marginLeft: 'auto' }} />
            </div>
            
            {/* MATCH NAME */}
            <div style={{ width: '70%', height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.05)', marginBottom: 12 }} />
            
            {/* BOTTOM INFO */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto' }}>
              <div style={{ width: 100, height: 16, borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
              <div style={{ width: 50, height: 24, borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
