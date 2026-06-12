interface SideNavBarProps {
  currentStage: string;
  onNavigate: (stage: string) => void;
}

const STAGES = [
  { key: "STAGE1", label: "概念讨论", icon: "lightbulb" },
  { key: "STAGE2", label: "世界观+角色", icon: "public" },
  { key: "STAGE3", label: "情节头脑风暴", icon: "account_tree" },
  { key: "STAGE4", label: "写作中心", icon: "edit_note" },
  { key: "STAGE5", label: "全书诊断", icon: "clinical_notes" },
  { key: "STAGE6", label: "导出中心", icon: "download" },
];

export default function SideNavBar({ currentStage, onNavigate }: SideNavBarProps) {
  return (
    <nav className="fixed left-0 top-16 w-[280px] h-[calc(100vh-64px)] bg-surface-container-low border-r border-outline-variant flex flex-col py-4">
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
            dashboard
          </span>
          仪表板
        </button>
      </div>

      <div className="border-t border-outline-variant mx-4 mb-4" />

      {/* Stage navigation */}
      <div className="px-4 mb-4 flex-1">
        <div className="font-label-mono text-system-log uppercase tracking-wider mb-2">
          叙事阶段
        </div>
        {STAGES.map((stage) => {
          const isActive = currentStage === stage.key;
          return (
            <button
              key={stage.key}
              onClick={() => onNavigate(stage.key)}
              className={`w-full text-left font-body-ui px-3 py-2 rounded transition-colors flex items-center gap-2 mb-1 ${
                isActive
                  ? "bg-primary-container/10 border-l-2 border-primary-container text-primary-container"
                  : "text-system-log hover:bg-surface-container hover:text-primary"
              }`}
            >
              <span className="material-symbols-outlined text-lg">
                {stage.icon}
              </span>
              {stage.label}
            </button>
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
          { label: "风格沙盒", icon: "palette" },
          { label: "资产中心", icon: "database" },
        ].map((item) => (
          <button
            key={item.label}
            disabled
            className="w-full text-left font-body-ui text-system-log/50 px-3 py-2 rounded flex items-center gap-2 opacity-50 pointer-events-none"
          >
            <span className="material-symbols-outlined text-lg">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* Settings */}
      <div className="px-4">
        <button className="w-full text-left font-body-ui text-system-log hover:text-primary hover:bg-surface-container px-3 py-2 rounded transition-colors flex items-center gap-2">
          <span className="material-symbols-outlined text-lg">settings</span>
          设置
        </button>
      </div>
    </nav>
  );
}
