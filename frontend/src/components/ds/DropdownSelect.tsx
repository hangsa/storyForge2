import { useEffect, useRef, useState } from "react";

export interface DropdownSelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  /** Which way the menu opens. Use "up" when the trigger sits near the
   *  bottom of an overflow-hidden container (e.g. BookShelf's pagination
   *  footer inside a rounded card) so the menu isn't clipped. Default
   *  "down" preserves the prior behavior for every other call site. */
  direction?: "down" | "up";
}

export default function DropdownSelect({
  label,
  options,
  value,
  onChange,
  direction = "down",
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentLabel = options.find((o) => o.value === value)?.label ?? "";
  const isUp = direction === "up";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 bg-surface-container border border-outline-variant rounded px-3 py-1.5 text-sm text-primary hover:bg-surface-container-high"
      >
        <span className="font-mono text-on-surface-variant">
          <span>{label}</span>
          <span aria-hidden="true">：</span>
        </span>
        <span>{currentLabel}</span>
        <span
          className={`material-symbols-outlined text-base transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>
      {open && (
        <div
          className={`absolute z-20 w-full bg-surface-container-high border border-outline-variant rounded shadow-lg ${
            isUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-sm text-on-surface hover:bg-surface-container"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}