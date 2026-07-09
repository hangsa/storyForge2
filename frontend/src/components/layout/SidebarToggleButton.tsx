interface SidebarToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function SidebarToggleButton({
  collapsed,
  onToggle,
}: SidebarToggleButtonProps) {
  const label = collapsed ? "展开侧边栏" : "收起侧边栏";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      className="font-body-ui text-system-log hover:text-primary transition-colors p-1 -ml-1 rounded"
    >
      <span className="material-symbols-outlined text-xl">menu</span>
    </button>
  );
}
