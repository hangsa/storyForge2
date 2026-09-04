export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  position: number;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "divergence", label: "创意发散", icon: "psychology",          position: 1 },
  { id: "concept",    label: "概念 DNA", icon: "biotech",             position: 2 },
  { id: "world",      label: "世界观",   icon: "public",               position: 3 },
  { id: "character",  label: "角色设计", icon: "groups",               position: 4 },
  { id: "map",        label: "地图系统", icon: "map",                  position: 5 },
  { id: "plot",       label: "剧情画布", icon: "account_tree",         position: 6 },
  { id: "outline",    label: "全文大纲", icon: "format_list_numbered", position: 7 },
  { id: "chapter",    label: "章节大纲", icon: "auto_stories",         position: 8 },
];

interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (item: SidebarItem) => void;
}

export default function WizardSidebar({
  currentStep,
  completedSteps,
  onJump,
}: WizardSidebarProps) {
  return (
    <nav data-testid="wizard-sidebar"
         className="bg-surface-container dark:bg-surface-container sticky top-16 self-start h-[calc(100vh-64px)] w-[200px] shrink-0 border-r border-outline-variant dark:border-outline-variant flex flex-col py-6 px-3 z-20">
      <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto pr-0 custom-scrollbar">
        {SIDEBAR_ITEMS.map((item) => {
          const completed = completedSteps.includes(item.position);
          const current = currentStep === item.position;
          // Step N is reachable when completed, current, or (N is the
          // next step and the previous step is completed).
          const reachable =
            completed ||
            current ||
            (item.position === currentStep + 1 && completedSteps.includes(currentStep));
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
