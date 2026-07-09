import { Outlet, useParams, useLocation, useNavigate } from "react-router-dom";

type Stage1SubTab = "quick" | "canvas";

function activeSubTabFromPath(pathname: string): Stage1SubTab {
  if (pathname.endsWith("/stage1/canvas")) return "canvas";
  return "quick";
}

export default function Stage1Layout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const active = activeSubTabFromPath(location.pathname);

  const goTo = (tab: Stage1SubTab) => {
    if (!projectId) return;
    navigate(`/project/${projectId}/stage1${tab === "canvas" ? "/canvas" : ""}`);
  };

  const tabs: { key: Stage1SubTab; label: string; icon: string }[] = [
    { key: "quick", label: "快速生成", icon: "bolt" },
    { key: "canvas", label: "创意画布", icon: "account_tree" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-3">
      {/* Page title — matches STAGE2 header placement */}
      <div>
        <h1 className="text-3xl font-bold text-primary-container">概念讨论</h1>
        <p className="font-body-ui text-system-log mt-0.5 text-sm">
          生成故事概念与核心矛盾，构建小说的叙事基础
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
