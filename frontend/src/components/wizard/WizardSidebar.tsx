const STEPS: Array<{ num: number; label: string; icon: string }> = [
  { num: 1, label: "创意发散", icon: "psychology" },
  { num: 2, label: "概念 DNA", icon: "biotech" },
  { num: 3, label: "世界观", icon: "public" },
  { num: 4, label: "角色设计", icon: "groups" },
  { num: 5, label: "地图系统", icon: "map" },
  { num: 6, label: "全文大纲", icon: "format_list_numbered" },
  { num: 7, label: "章节大纲", icon: "auto_stories" },
];

/**
 * Module entries are non-step links that live alongside the wizard's
 * linear flow. They navigate the user to a sibling page (a `path` built
 * by the caller — typically `/project/:id/<module-route>`) rather than
 * driving wizard state. Modules are rendered in the order given, between
 * the step whose `num` matches `afterStep` and the next step.
 *
 * Rationale for the `afterStep` placement contract: 创意画布 must sit
 * between 创意发散 (#1) and 概念 DNA (#2) so the user perceives it as
 * "an alternative divergence surface" rather than something that comes
 * after the concept is locked in. New module positions are added by
 * extending the `insertModulesAfter(num)` index — keep the rule explicit
 * so the next person doesn't have to read both the wizard and the
 * module list to figure out why their tab is in the wrong place.
 */
export interface WizardSidebarModule {
  id: string;
  label: string;
  icon: string;
  path: string;
}

interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (step: number) => void;
  /**
   * Modules to render alongside the linear step list. Each module lands
   * between `afterStep` (the step's `num`) and the next step. Modules
   * with no matching afterStep are appended at the bottom of the sidebar.
   */
  modules?: WizardSidebarModule[];
  /**
   * Insertion anchor: modules in `modules` whose insertion point matches
   * this step's `num` are rendered immediately after this step. The
   * single value applies to all modules; if you need per-module anchors,
   * extend the prop shape (kept as one value for now since the only
   * caller inserts everything between #1 and #2).
   */
  insertModulesAfter?: number;
  /**
   * Called with the module's `path` when the user clicks a module entry.
   * Receivers should `navigate(path)` — the sidebar intentionally doesn't
   * pull in `useNavigate` itself so it stays easy to unit-test (no router
   * provider needed).
   */
  onModuleNavigate?: (path: string) => void;
}

export default function WizardSidebar({
  currentStep,
  completedSteps,
  onJump,
  modules = [],
  insertModulesAfter = 1,
  onModuleNavigate,
}: WizardSidebarProps) {
  return (
    <nav data-testid="wizard-sidebar"
         className="bg-surface-container dark:bg-surface-container sticky top-16 self-start h-[calc(100vh-64px)] w-[200px] shrink-0 border-r border-outline-variant dark:border-outline-variant flex flex-col py-6 px-3 z-20">
      <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto pr-0 custom-scrollbar">
        {STEPS.map(({ num, label, icon }) => {
          const completed = completedSteps.includes(num);
          const current = currentStep === num;
          const reachable = completed || current;
          const baseCls = "flex items-center justify-start gap-2 px-3 py-2 rounded-lg transition-colors w-[160px]";
          const stateCls = current
            ? "bg-secondary-container text-on-secondary-container font-bold scale-[0.98] transition-transform duration-150"
            : "text-on-surface-variant hover:bg-surface-variant dark:hover:bg-surface-variant";
          return (
            <div key={num} className="flex flex-col items-center gap-2">
              <button
                type="button"
                data-testid={`wizard-sidebar-item-${num}`}
                data-state={completed ? "completed" : current ? "current" : "pending"}
                disabled={!reachable}
                onClick={() => reachable && onJump(num)}
                className={`${baseCls} ${stateCls} ${!reachable ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <span
                  className="material-symbols-outlined text-[20px] leading-none"
                  style={{ fontVariationSettings: current ? '"FILL" 1' : '"FILL" 0' }}
                >
                  {icon}
                </span>
                <span className="font-body-md text-sm whitespace-nowrap">{label}</span>
                {completed && !current && (
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-primary ml-auto">
                    check
                  </span>
                )}
              </button>
              {/* Module slot — rendered between the step matching
                  `insertModulesAfter` and the next step. Visually
                  distinguished by a thinner outline + `open_in_new`
                  affordance so the user reads it as "go to a sibling
                  page" rather than "advance through the wizard". */}
              {num === insertModulesAfter && modules.length > 0 && (
                <div
                  data-testid="wizard-sidebar-modules"
                  className="flex flex-col items-center gap-2 w-[160px] pt-1 border-t border-dashed border-outline-variant/60"
                >
                  {modules.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`wizard-sidebar-module-${m.id}`}
                      onClick={() => onModuleNavigate?.(m.path)}
                      className={`${baseCls} text-on-surface-variant hover:bg-surface-variant dark:hover:bg-surface-variant border border-dashed border-outline-variant/60 hover:border-primary/60`}
                      title={m.path}
                    >
                      <span className="material-symbols-outlined text-[20px] leading-none">
                        {m.icon}
                      </span>
                      <span className="font-body-md text-sm whitespace-nowrap">{m.label}</span>
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined text-[14px] leading-none ml-auto text-on-surface-variant/70"
                      >
                        open_in_new
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}