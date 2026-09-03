interface PathSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  active: boolean;
}

/**
 * Render bezier paths between option nodes. Active = solid primary glow;
 * inactive = dashed outline-variant.
 */
export function TreePath({ paths }: { paths: PathSegment[] }) {
  return (
    <svg
      className="absolute top-0 left-0 w-full h-full pointer-events-none z-0"
      style={{ minWidth: 1200 }}
    >
      {paths.map((p, i) => {
        const midX = (p.fromX + p.toX) / 2;
        const d = `M ${p.fromX} ${p.fromY} C ${midX} ${p.fromY}, ${midX} ${p.toY}, ${p.toX} ${p.toY}`;
        if (p.active) {
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={2}
              style={{ filter: "drop-shadow(0 0 4px #38bdf8)" }}
            />
          );
        }
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#3e484f"
            strokeDasharray="4 4"
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}
