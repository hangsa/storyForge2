export interface PhaseIndicatorPhase {
  key: string;
  label: string;
  count: number;
  active?: boolean;
  completed?: boolean;
}

export interface PhaseIndicatorProps {
  phases: PhaseIndicatorPhase[];
  onPhaseClick?: (key: string) => void;
}

function markerClass(phase: PhaseIndicatorPhase): string {
  if (phase.active) return "w-2 h-2 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse";
  if (phase.completed) return "w-2 h-2 rounded-full bg-primary";
  return "w-2 h-2 rounded-full bg-outline-variant";
}

export default function PhaseIndicator({ phases, onPhaseClick }: PhaseIndicatorProps) {
  return (
    <ul className="flex flex-col gap-2">
      {phases.map((p) => (
        <li key={p.key}>
          <button
            type="button"
            onClick={() => onPhaseClick?.(p.key)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="flex items-center gap-2">
              <span className={markerClass(p)} aria-hidden="true" />
              <span className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant">
                {p.label}
              </span>
            </span>
            <span className="text-label-sm text-on-surface font-mono">{p.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
