type Slot = "a" | "b" | "c";

interface Props {
  testId: string; // e.g. "option-node-1-b"
  slot: Slot;
  label: string; // user-visible option label, e.g. "保留灵气"
  selected: boolean;
  faded?: boolean; // unselected options dim
}

export function OptionNode({ testId, slot, label, selected, faded = false }: Props) {
  if (selected) {
    return (
      <div
        data-testid={testId}
        className="flex flex-col items-center relative top-[-10px]"
      >
        <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/50 text-primary flex items-center justify-center mb-sm shadow-[0_0_10px_rgba(56,189,248,0.2)]">
          <span
            data-check-icon
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            check
          </span>
        </div>
        <span
          className="text-xs text-primary max-w-[100px] truncate"
          title={label}
        >
          {label}
        </span>
      </div>
    );
  }
  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-center transition-opacity cursor-pointer ${
        faded ? "opacity-30" : "opacity-50 hover:opacity-100"
      }`}
    >
      <div className="w-10 h-10 rounded-full bg-surface-variant border border-outline-variant flex items-center justify-center mb-1">
        <span className="text-xs uppercase">{slot}</span>
      </div>
      <span
        className="text-xs text-on-surface-variant max-w-[100px] truncate"
        title={label}
      >
        {label}
      </span>
    </div>
  );
}
