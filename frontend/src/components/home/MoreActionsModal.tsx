import { useTheme, type Theme } from "../../hooks/useTheme";

interface MoreActionsModalProps {
  onClose: () => void;
}

interface ThemeOption {
  id: Theme;
  label: string;
  description: string;
  /** Preview swatches — [background, surface, primary]. */
  swatches: [string, string, string];
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "dark",
    label: "深色",
    description: "默认主题，适合长时间创作",
    swatches: ["#020617", "#171f33", "#00f0ff"],
  },
  {
    id: "light",
    label: "浅色",
    description: "明亮简洁，适合白天工作",
    swatches: ["#f8fafc", "#f1f5f9", "#006970"],
  },
];

export default function MoreActionsModal({ onClose }: MoreActionsModalProps) {
  const [theme, setTheme] = useTheme();

  return (
    <div
      data-testid="more-actions-modal"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
        <header className="px-6 py-4 flex items-center justify-between border-b border-outline-variant">
          <h2 className="font-display text-title-md text-primary">更多</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            data-testid="more-actions-close"
            className="text-on-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="p-6 space-y-3">
          <div className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-wider">
            主题
          </div>
          <div className="space-y-2">
            {THEME_OPTIONS.map((opt) => {
              const selected = theme === opt.id;
              return (
                <label
                  key={opt.id}
                  data-testid={`theme-option-${opt.id}`}
                  data-selected={selected ? "true" : "false"}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected
                      ? "border-primary-container bg-surface-container"
                      : "border-outline-variant bg-surface-container-low hover:border-primary-container/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={opt.id}
                    checked={selected}
                    onChange={() => setTheme(opt.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      selected
                        ? "border-primary-container bg-primary-container"
                        : "border-outline-variant bg-surface-container-lowest"
                    }`}
                  >
                    {selected && (
                      <span className="h-1.5 w-1.5 rounded-full bg-surface-container-lowest" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-primary text-sm">{opt.label}</div>
                    <div className="font-body-ui text-on-surface-variant text-xs">
                      {opt.description}
                    </div>
                  </div>
                  <div
                    aria-hidden
                    className="flex h-7 w-12 overflow-hidden rounded border border-outline-variant shrink-0"
                  >
                    {opt.swatches.map((c, i) => (
                      <span
                        key={i}
                        className="flex-1"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}