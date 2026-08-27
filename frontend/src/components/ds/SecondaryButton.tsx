export interface SecondaryButtonProps {
  label: string;
  icon?: string;
  variant?: "default" | "destructive";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}

const SIZE_CLASS: Record<NonNullable<SecondaryButtonProps["size"]>, string> = {
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2 text-base",
};

export default function SecondaryButton({
  label,
  icon,
  variant = "default",
  size = "md",
  disabled = false,
  onClick,
  testId,
}: SecondaryButtonProps) {
  const colorClass =
    variant === "destructive"
      ? "border-error-container text-error"
      : "border-outline-variant text-on-surface";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`inline-flex items-center gap-2 bg-surface-container border ${colorClass} rounded ${SIZE_CLASS[size]} hover:bg-surface-container-high transition disabled:opacity-50`}
    >
      {icon && <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}