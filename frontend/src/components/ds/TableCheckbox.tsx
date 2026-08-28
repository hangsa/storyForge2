export interface TableCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** When true, clicking the checkbox does NOT propagate to the row click
   *  handler (every BookShelf row has `onClick` for navigation). */
  stopRowClickPropagation?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  testId?: string;
}

export default function TableCheckbox({
  checked,
  onChange,
  stopRowClickPropagation = false,
  disabled = false,
  ariaLabel,
  testId,
}: TableCheckboxProps) {
  return (
    <div className="flex items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        onClick={stopRowClickPropagation ? (e) => e.stopPropagation() : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        className="w-4 h-4 accent-primary"
      />
    </div>
  );
}
