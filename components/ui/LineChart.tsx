export interface LineChartProps {
  data: { label: string; value: number; isNegative?: boolean }[];
  height?: number;
  colorPrimary?: string;
  colorSecondary?: string;
}

export default function LineChart({
  data,
  height = 180,
  colorPrimary = 'var(--accent-green)',
  colorSecondary = 'var(--accent-red)'
}: LineChartProps) {
  if (data.length < 2) {
    return (
      <div style={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
        <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
          No hay suficientes datos para el gráfico.
        </p>
      </div>
    );
  }

  const values = data.map(d => d.value);
  const initialValue = values[0];
  const maxVal = Math.max(...values, initialValue);
  const minVal = Math.min(...values, 0); // Include 0 or less if negative
  const range = maxVal - minVal || 1;

  const getCy = (val: number) => 20 + (1 - (val - minVal) / range) * (height - 40);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${Math.max(data.length * 40 + 40, 300)} ${height}`}
        style={{ width: '100%', minWidth: 300, height, display: 'block' }}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = 20 + (1 - ratio) * (height - 40);
          const val = minVal + ratio * range;
          return (
            <g key={`grid-line-${i}`}>
              <line x1="40" y1={y} x2={data.length * 40 + 10} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              <text x="35" y={y + 4} fontSize="9" fill="var(--foreground-muted)" textAnchor="end">{Math.round(val)}</text>
            </g>
          );
        })}

        {/* Area fill */}
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorPrimary} stopOpacity="0.3" />
            <stop offset="100%" stopColor={colorPrimary} stopOpacity="0" />
          </linearGradient>
        </defs>

        <polyline
          fill="url(#areaGrad)"
          stroke="none"
          points={[
            `40,${getCy(initialValue)}`,
            ...data.map((p, i) => `${(i + 1) * 40 + 10},${getCy(p.value)}`),
            `${data.length * 40 + 10},${height - 20}`,
            `40,${height - 20}`,
          ].join(' ')}
        />

        {/* Line */}
        <polyline
          fill="none"
          stroke={colorPrimary}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={[
            `40,${getCy(initialValue)}`, // starts assuming x=40
            ...data.map((p, i) => `${(i + 1) * 40 + 10},${getCy(p.value)}`),
          ].join(' ')}
        />

        {/* Dots */}
        {data.map((p, i) => {
          const cx = (i + 1) * 40 + 10;
          const cy = getCy(p.value);
          const isNegative = p.isNegative;
          return (
            <circle
              key={`dot-${i}`}
              cx={cx}
              cy={cy}
              r="4"
              fill={isNegative ? colorSecondary : colorPrimary}
              stroke="var(--background-card)"
              strokeWidth="2"
            />
          );
        })}

        {/* Labels */}
        {data.map((p, i) => (
          <text key={`label-${i}`} x={(i + 1) * 40 + 10} y={height - 5} fontSize="9" fill="var(--foreground-muted)" textAnchor="middle">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
