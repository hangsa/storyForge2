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
    { key: "canvas", label: "创意画布", icon: "draw" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-3">
      <div>
        <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface">
          Stage 1 — 概念
        </h1>
        <p className="text-sm text-on-surface-variant">
          从一个 Idea 出发，生成你的故事核心。
        </p>
      </div>
      <div className="flex gap-1 bg-surface-container rounded-lg p-1 w-fit">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => goTo(key)}
            data-testid={`stage1-tab-${key}`}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-body-ui text-sm transition-colors ${
              active === key
                ? "bg-secondary-container text-on-secondary-container font-bold scale-[0.98] transition-transform duration-150"
                : "text-system-log hover:text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
