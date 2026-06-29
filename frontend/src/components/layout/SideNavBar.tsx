interface SideNavBarProps {
  currentStage: string;
  onNavigate: (stage: string) => void;
}

interface StageItem {
  key: string;
  label: string;
  icon: string;
  subItems?: { key: string; label: string; icon: string; path: string }[];
}

const STAGES: StageItem[] = [
  { key: "STAGE1", label: "概念讨论", icon: "lightbulb" },
  { key: "STAGE2", label: "世界观+角色", icon: "public" },
  { key: "STAGE3", label: "情节头脑风暴", icon: "account_tree" },
  { key: "STAGE4", label: "写作中心", icon: "edit_note" },
  { key: "STAGE5", label: "全书诊断", icon: "clinical_notes" },
  { key: "STAGE6", label: "导出中心", icon: "download" },
];

export default function SideNavBar({ currentStage, onNavigate }: SideNavBarProps) {
  return (
    <nav className="fixed left-0 top-16 w-[280px] h-[calc(100vh-64px)] bg-surface-container-low border-r border-outline-variant flex flex-col py-4 overflow-y-auto">
      {/* Project section */}
      <div className="px-4 mb-4">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          项目
        </div>
        <button
          onClick={() => onNavigate("dashboard")}
          className="w-full text-left font-body-ui text-primary hover:bg-surface-container px-3 py-2 rounded transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg text-system-log">
            folder_open
          </span>
          项目中心
        </button>
      </div>

      <div className="border-t border-outline-variant mx-4 mb-4" />

      {/* Stage navigation */}
      <div className="px-4 mb-4">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          叙事阶段
        </div>
        {STAGES.map((stage) => {
          const isMainActive = currentStage === stage.key;
          const hasSubItems = stage.subItems && stage.subItems.length > 0;
          const isSubActive = hasSubItems && stage.subItems!.some(
            (sub) => currentStage === sub.key
          );

          return (
            <div key={stage.key} className="mb-1">
              {/* Main item */}
              <button
                onClick={() => onNavigate(stage.key)}
                className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 ${
                  isMainActive || isSubActive
                    ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
                    : "text-system-log hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-lg">{stage.icon}</span>
                {stage.label}
              </button>

              {/* Sub-items (indented) */}
              {hasSubItems && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {stage.subItems!.map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => onNavigate(sub.key)}
                      className={`w-full text-left font-body-ui text-sm px-3 py-1.5 rounded transition-colors flex items-center gap-2 ${
                        currentStage === sub.key
                          ? "bg-primary-container/5 text-primary-container"
                          : "text-system-log/70 hover:text-primary hover:bg-surface-container"
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">{sub.icon}</span>
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-outline-variant mx-4 mb-4" />

      {/* Workspace (MVP disabled) */}
      <div className="px-4 mb-4">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          工作区
        </div>
        {[
          { label: "灵感库", icon: "draw" },
          { label: "风格沙盒", icon: "palette", stage: "STYLE" },
          { label: "章节审查", icon: "rate_review", stage: "REVIEW" },
          { label: "影响分析", icon: "find_in_page", stage: "IMPACT" },
          { label: "资产中心", icon: "database", stage: "STORYOS" },
        ].map((item) => {
          if ("stage" in item) {
            return (
              <button
                key={item.label}
                onClick={() => onNavigate(item.stage!)}
                className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 ${
                  currentStage === item.stage
                    ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
                    : "text-system-log hover:bg-surface-container hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-lg">{item.icon}</span>
                {item.label}
              </button>
            );
          }
          return (
            <button
              key={item.label}
              disabled
              className="w-full text-left font-body-ui text-system-log/50 px-3 py-2 rounded flex items-center gap-2 opacity-50 pointer-events-none"
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Settings */}
      <div className="px-4">
        <button
          onClick={() => onNavigate("SETTINGS")}
          className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 ${
            currentStage === "SETTINGS"
              ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
              : "text-system-log hover:text-primary hover:bg-surface-container"
          }`}
        >
          <span className="material-symbols-outlined text-lg">settings</span>
          设置
        </button>
      </div>
    </nav>
  );
}
