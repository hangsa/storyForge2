export interface BrandHeaderProps {
  brandName: string;
  tagline?: string;        // default "让你的灵感长出血肉"
  iconName?: string;       // default "auto_stories"
  collapsed?: boolean;     // default false — hides text, keeps icon
  /** Optional version chip. */
  version?: string;
  /** Optional data-testid for the version chip. */
  versionTestId?: string;
  /** Layout for the version chip. `"inline"` (default) renders the chip on
   *  the right of the brand row; `"stacked"` renders it on its own row
   *  above the brand text, matching the Nebula Forge mockup. */
  versionLayout?: "inline" | "stacked";
}

export default function BrandHeader({
  brandName,
  tagline = "让你的灵感长出血肉",
  iconName = "auto_stories",
  collapsed = false,
  version,
  versionTestId,
  versionLayout = "inline",
}: BrandHeaderProps) {
  if (versionLayout === "stacked") {
    return (
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined text-primary-container text-2xl"
          aria-hidden="true"
        >
          {iconName}
        </span>
        {!collapsed && (
          <div className="flex flex-row items-baseline gap-2">
            <span className="font-display text-primary text-lg leading-tight">
              {brandName}
            </span>
            <span className="font-body text-on-surface-variant text-xs leading-tight">
              {tagline}
            </span>
            {version && (
              <span
                data-testid={versionTestId}
                className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant border border-outline-variant rounded px-1.5 py-0.5"
              >
                {version}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

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
      {!collapsed && version && (
        <span
          data-testid={versionTestId}
          className="ml-auto font-mono text-[10px] uppercase tracking-wider text-on-surface-variant border border-outline-variant rounded px-1.5 py-0.5"
        >
          {version}
        </span>
      )}
    </div>
  );
}