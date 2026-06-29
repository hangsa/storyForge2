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
    <>
      {/* Page title — matches STAGE2 header placement */}
      <div className="max-w-5xl mx-auto pt-8 px-6">
        <h1 className="text-4xl font-bold text-primary-container">概念讨论</h1>
        <p className="font-body-ui text-system-log mt-1">
          生成故事概念与核心矛盾，构建小说的叙事基础
        </p>
      </div>

      {/* Tab switcher — pill / segmented-control style (mirrors STAGE2) */}
      <div className="max-w-5xl mx-auto px-6 mt-6">
        <div className="flex gap-1 bg-surface-container rounded-lg p-1 w-fit">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => goTo(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-body-ui text-sm transition-colors ${
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
      </div>

      {/* Child page content */}
      <div className="max-w-5xl mx-auto px-6 pb-8">
        <Outlet />
      </div>
    </>
  );
}
