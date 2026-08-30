const STEPS: Array<{ num: number; label: string; icon: string }> = [
  { num: 1, label: "创意发散", icon: "psychology" },
  { num: 2, label: "概念 DNA", icon: "biotech" },
  { num: 3, label: "世界观", icon: "public" },
  { num: 4, label: "角色设计", icon: "groups" },
  { num: 5, label: "地图系统", icon: "map" },
  { num: 6, label: "全文大纲", icon: "format_list_numbered" },
  { num: 7, label: "章节大纲", icon: "auto_stories" },
];

interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (step: number) => void;
}

export default function WizardSidebar({ currentStep, completedSteps, onJump }: WizardSidebarProps) {
  return (
    <nav data-testid="wizard-sidebar"
         className="bg-surface-container dark:bg-surface-container sticky top-16 self-start h-[calc(100vh-64px)] w-[240px] shrink-0 border-r border-outline-variant dark:border-outline-variant flex flex-col py-md px-sm z-20">
      <div className="flex-1 space-y-xs overflow-y-auto pr-xs custom-scrollbar">
        {STEPS.map(({ num, label, icon }) => {
          const completed = completedSteps.includes(num);
          const current = currentStep === num;
          const reachable = completed || current;
          const baseCls = "flex items-center gap-sm px-md py-xs rounded-lg transition-colors";
          const stateCls = current
            ? "bg-secondary-container text-on-secondary-container font-bold scale-95 transition-transform duration-150"
            : "text-on-surface-variant hover:bg-surface-variant dark:hover:bg-surface-variant";
          return (
            <button
              key={num}
              type="button"
              data-testid={`wizard-sidebar-item-${num}`}
              data-state={completed ? "completed" : current ? "current" : "pending"}
              disabled={!reachable}
              onClick={() => reachable && onJump(num)}
              className={`${baseCls} ${stateCls} ${!reachable ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: current ? '"FILL" 1' : '"FILL" 0' }}
              >
                {icon}
              </span>
              <span className="font-body-md text-body-md">{label}</span>
              {completed && !current && (
                <span aria-hidden="true" className="material-symbols-outlined ml-auto text-[16px] text-primary">
                  check
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}