export interface SparklineProps {
  /** Data points. Renders nothing when empty or all-zero. */
  data: number[];
  width?: number;
  height?: number;
  /** Optional stroke class (Tailwind). Defaults to text-primary-container. */
  strokeClass?: string;
  /** Optional data-testid on the <svg>. */
  testId?: string;
}

export default function Sparkline({
  data,
  width = 80,
  height = 20,
  strokeClass = "stroke-primary-container",
  testId,
}: SparklineProps) {
  const points = data.filter((v) => Number.isFinite(v));
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);

  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      data-testid={testId}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="趋势线"
      className="overflow-visible"
    >
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClass}
      />
    </svg>
  );
}