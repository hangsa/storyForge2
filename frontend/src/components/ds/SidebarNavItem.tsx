export interface SidebarNavItemProps {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
  /** Optional data-testid applied to the underlying <button>. */
  testId?: string;
}

export default function SidebarNavItem({
  icon,
  label,
  active = false,
  onClick,
  collapsed = false,
  testId,
}: SidebarNavItemProps) {
  const activeClass = active
    ? "bg-primary-container/15 text-primary border-l-2 border-primary -ml-0.5 pl-3.5"
    : "text-on-surface-variant hover:text-primary hover:bg-surface-container-low";

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`w-full flex items-center gap-2 py-2 pl-4 pr-3 text-sm transition border-l-2 border-transparent ${activeClass}`}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}