export default function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '2rem', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
      <p style={{ color: 'var(--accent-red)', fontWeight: 600 }}>{message}</p>
      <p style={{ color: 'var(--foreground-muted)', fontSize: '0.82rem', marginTop: 8 }}>
        Intenta recargar la página.
      </p>
    </div>
  );
}
