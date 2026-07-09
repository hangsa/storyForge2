import { Outlet, useParams, useLocation, useNavigate } from "react-router-dom";

type Stage3SubTab = "novel-outline" | "outline" | "branches";

function activeSubTabFromPath(pathname: string): Stage3SubTab {
  if (pathname.endsWith("/stage3/branches")) return "branches";
  if (pathname.endsWith("/stage3/outline")) return "outline";
  return "novel-outline";
}

export default function Stage3Layout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const active = activeSubTabFromPath(location.pathname);

  const goTo = (tab: Stage3SubTab) => {
    if (!projectId) return;
    if (tab === "branches") navigate(`/project/${projectId}/stage3/branches`);
    else if (tab === "outline") navigate(`/project/${projectId}/stage3/outline`);
    else navigate(`/project/${projectId}/stage3`);
  };

  const tabs: { key: Stage3SubTab; label: string; icon: string }[] = [
    { key: "novel-outline", label: "全书大纲", icon: "menu_book" },
    { key: "outline", label: "大纲视图", icon: "list_alt" },
    { key: "branches", label: "分支模拟", icon: "call_split" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-3">
      {/* Page title — matches STAGE2 header placement */}
      <div>
        <h1 className="text-3xl font-bold text-primary-container">情节头脑风暴</h1>
        <p className="font-body-ui text-system-log mt-0.5 text-sm">
          规划章节结构与场景节奏，设计叙事弧线
        </p>
      </div>

      {/* Tab switcher — pill / segmented-control style (mirrors STAGE2) */}
      <div className="flex gap-1 bg-surface-container rounded-lg p-1 w-fit">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => goTo(key)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-body-ui text-sm transition-colors ${
              active === key
                ? "bg-primary-container text-surface-container-low"
                : "text-system-log hover:text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Child page content */}
      <Outlet />
    </div>
  );
}
