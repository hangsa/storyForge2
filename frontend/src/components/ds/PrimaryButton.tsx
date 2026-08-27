export interface PrimaryButtonProps {
  label: string;
  icon?: "plus" | "search" | "delete";
  iconPosition?: "leading" | "trailing";
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const SIZE_CLASS: Record<NonNullable<PrimaryButtonProps["size"]>, string> = {
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2 text-base",
};

// Icon sits one notch smaller than the label so it reads as a glyph, not a letter.
const ICON_SIZE_CLASS: Record<NonNullable<PrimaryButtonProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
};

export default function PrimaryButton({
  label,
  icon,
  iconPosition = "leading",
  size = "md",
  loading = false,
  disabled = false,
  onClick,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const iconClass = `material-symbols-outlined ${ICON_SIZE_CLASS[size]}`;
  const iconEl = loading ? (
    <span className={`${iconClass} animate-spin`} aria-hidden="true">progress_activity</span>
  ) : icon ? (
    <span className={iconClass} aria-hidden="true">{icon}</span>
  ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`inline-flex items-center gap-2 bg-primary text-on-primary rounded ${SIZE_CLASS[size]} hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {iconEl && iconPosition === "leading" && iconEl}
      <span>{label}</span>
      {iconEl && iconPosition === "trailing" && iconEl}
    </button>
  );
}