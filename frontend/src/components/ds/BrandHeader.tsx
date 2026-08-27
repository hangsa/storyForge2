export interface BrandHeaderProps {
  brandName: string;
  tagline?: string;        // default "让你的灵感长出血肉"
  iconName?: string;       // default "auto_stories"
  collapsed?: boolean;     // default false — hides text, keeps icon
}

export default function BrandHeader({
  brandName,
  tagline = "让你的灵感长出血肉",
  iconName = "auto_stories",
  collapsed = false,
}: BrandHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="material-symbols-outlined text-primary-container text-2xl"
        aria-hidden="true"
      >
        {iconName}
      </span>
      {!collapsed && (
        <div className="flex flex-col">
          <span className="font-display text-primary text-lg leading-tight">
            {brandName}
          </span>
          <span className="font-body text-on-surface-variant text-xs leading-tight">
            {tagline}
          </span>
        </div>
      )}
    </div>
  );
}
