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

  const tabClass = (tab: Stage3SubTab) =>
    `px-4 py-2 font-body-ui text-sm rounded-lg ${
      active === tab
        ? "bg-primary-container/10 text-primary-container border-b-2 border-primary-container"
        : "text-system-log hover:text-primary hover:bg-surface-container transition-colors"
    }`;

  return (
    <>
      <div className="pt-1 pb-3">
        <div className="flex items-center gap-1">
          <button onClick={() => goTo("novel-outline")} className={tabClass("novel-outline")}>
            <span className="material-symbols-outlined text-sm align-middle mr-1">menu_book</span>
            全书大纲
          </button>
          <button onClick={() => goTo("outline")} className={tabClass("outline")}>
            <span className="material-symbols-outlined text-sm align-middle mr-1">list_alt</span>
            大纲视图
          </button>
          <button onClick={() => goTo("branches")} className={tabClass("branches")}>
            <span className="material-symbols-outlined text-sm align-middle mr-1">call_split</span>
            分支模拟
          </button>
        </div>
      </div>
      <Outlet />
    </>
  );
}
