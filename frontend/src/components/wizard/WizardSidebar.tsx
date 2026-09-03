import type { Step1SurfaceId } from "./WizardContext";

export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  /** 1..7 — visual row position. Position 1 has 2 surface items (divergence + canvas). */
  position: number;
  /** "step1-surface" → parallel step-1 entry (no step number); undefined → ordinary step. */
  kind?: "step1-surface";
  /** Only meaningful when kind === "step1-surface". */
  surfaceId?: Step1SurfaceId;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "divergence", label: "创意发散", icon: "psychology", position: 1, kind: "step1-surface", surfaceId: "divergence" },
  { id: "canvas",     label: "创意画布", icon: "account_tree", position: 1, kind: "step1-surface", surfaceId: "canvas" },
  { id: "concept",    label: "概念 DNA", icon: "biotech",     position: 2 },
  { id: "world",      label: "世界观",   icon: "public",       position: 3 },
  { id: "character",  label: "角色设计", icon: "groups",       position: 4 },
  { id: "map",        label: "地图系统", icon: "map",          position: 5 },
  { id: "outline",    label: "全文大纲", icon: "format_list_numbered", position: 6 },
  { id: "chapter",    label: "章节大纲", icon: "auto_stories", position: 7 },
];

interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  activeStep1Surface: Step1SurfaceId;
  completedStep1Surfaces: Step1SurfaceId[];
  onJump: (item: SidebarItem) => void;
}

export default function WizardSidebar({
  currentStep,
  completedSteps,
  activeStep1Surface,
  completedStep1Surfaces,
  onJump,
}: WizardSidebarProps) {
  return (
    <nav data-testid="wizard-sidebar"
         className="bg-surface-container dark:bg-surface-container sticky top-16 self-start h-[calc(100vh-64px)] w-[200px] shrink-0 border-r border-outline-variant dark:border-outline-variant flex flex-col py-6 px-3 z-20">
      <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto pr-0 custom-scrollbar">
        {SIDEBAR_ITEMS.map((item) => {
          const isStep1Surface = item.kind === "step1-surface";
          // surface item completed = in completedStep1Surfaces; ordinary
          // step = in completedSteps. WizardContext's
          // MARK_STEP1_SURFACE_COMPLETED reducer keeps completedSteps
          // in sync (pushes 1 when a surface commits), but the sidebar
          // also ORs against the surface list directly so unit tests
          // and legacy projects (where completedSteps was set before
          // canvas existed) reach step 2 without reducer round-trips.
          const completed = isStep1Surface
            ? completedStep1Surfaces.includes(item.surfaceId!)
            : completedSteps.includes(item.position);
          const current = isStep1Surface
            ? currentStep === 1 && activeStep1Surface === item.surfaceId
            : currentStep === item.position;
          // Step 1 is "effectively complete" when any surface row has
          // committed, OR when step 1 is in the legacy completedSteps
          // list. This is the OR semantic: divergence done OR canvas
          // done OR legacy step 1 done.
          const step1Effective =
            completedStep1Surfaces.length >= 1 || completedSteps.includes(1);
          // Reachable rules:
            // - surface rows: any row at position 1 is reachable when
            //   you're on step 1 (so you can switch between divergence
            //   and canvas freely), or when completed.
            // - ordinary rows: completed || current || (step 1 effective
            //   AND this is step 2 — the next step after step 1).
          const reachable = isStep1Surface
            ? completed || current || currentStep === 1
            : completed || current || (item.position === 2 && step1Effective);
          const baseCls = "flex items-center justify-start gap-2 px-3 py-2 rounded-lg transition-colors w-[160px]";
          const stateCls = current
            ? "bg-secondary-container text-on-secondary-container font-bold scale-[0.98] transition-transform duration-150"
            : "text-on-surface-variant hover:bg-surface-variant dark:hover:bg-surface-variant";
          return (
            <div key={item.id} className="flex flex-col items-center gap-2">
              <button
                type="button"
                data-testid={`wizard-sidebar-item-${item.id}`}
                data-state={completed ? "completed" : current ? "current" : "pending"}
                disabled={!reachable}
                onClick={() => reachable && onJump(item)}
                className={`${baseCls} ${stateCls} ${!reachable ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <span
                  className="material-symbols-outlined text-[20px] leading-none"
                  style={{ fontVariationSettings: current ? '"FILL" 1' : '"FILL" 0' }}
                >
                  {item.icon}
                </span>
                <span className="font-body-md text-sm whitespace-nowrap">{item.label}</span>
                {completed && !current && (
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-primary ml-auto">
                    check
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}