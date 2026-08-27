export interface GhostButtonProps {
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onClick: () => void;
}

const SIZE_CLASS: Record<NonNullable<GhostButtonProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
};

export default function GhostButton({
  label,
  size = "md",
  disabled = false,
  onClick,
}: GhostButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`font-mono text-on-surface-variant hover:text-primary transition disabled:opacity-50 ${SIZE_CLASS[size]}`}
    >
      {label}
    </button>
  );
}