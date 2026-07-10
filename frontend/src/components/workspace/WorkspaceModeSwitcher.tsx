import type { WorkspaceMode } from "../../hooks/useWorkspaceMode";

interface Props {
  mode: WorkspaceMode;
  onChange: (m: WorkspaceMode) => void;
}

const SEGMENTS: { value: WorkspaceMode; label: string }[] = [
  { value: "managed", label: "托管" },
  { value: "manual", label: "手动" },
];

export default function WorkspaceModeSwitcher({ mode, onChange }: Props) {
  return (
    <div
      data-testid="workspace-mode-switcher"
      className="inline-flex rounded-full border border-outline-variant p-0.5 bg-surface-container text-sm"
    >
      {SEGMENTS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          data-testid={`mode-${value}`}
          onClick={() => onChange(value)}
          className={`px-3 py-1 rounded-full font-body-ui transition-colors ${
            mode === value
              ? "bg-primary-container text-surface-container-low"
              : "text-system-log hover:text-primary"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}