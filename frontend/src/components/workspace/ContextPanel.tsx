import { useEffect, useState } from "react";
import { useWorkspacePanel, type WorkspacePanel } from "../../hooks/useWorkspacePanel";
import api from "../../api/client";

interface Props {
  projectId: string;
}

const TABS: { id: WorkspacePanel; label: string }[] = [
  { id: "concept", label: "概念" },
  { id: "world", label: "世界观" },
  { id: "character", label: "角色" },
  { id: "outline", label: "大纲" },
  { id: "diagnosis", label: "诊断" },
  { id: "export", label: "导出" },
];

export default function ContextPanel({ projectId }: Props) {
  const { panel, setPanel } = useWorkspacePanel();
  const [content, setContent] = useState<string>("加载中…");

  useEffect(() => {
    let cancelled = false;
    const fetcher: Record<WorkspacePanel, () => Promise<unknown>> = {
      concept: () => api.getConcept(projectId),
      world: () => api.getWorld(projectId),
      character: () => api.getCharacter(projectId),
      outline: () => api.getOutline(projectId),
      diagnosis: () => Promise.resolve({ note: "v1.8 诊断功能由 Stage5 提供" }),
      export: () => Promise.resolve({ note: "v1.8 导出功能由 Stage6 提供" }),
    };
    fetcher[panel]()
      .then(() => !cancelled && setContent(`${panel} 数据已就绪 — 内联编辑面板待 v1.8.1 接入`))
      .catch(() => !cancelled && setContent("加载失败"));
    return () => {
      cancelled = true;
    };
  }, [panel, projectId]);

  return (
    <div data-testid="context-panel" className="h-full flex flex-col">
      <div className="flex border-b border-outline-variant overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`context-tab-${t.id}${panel === t.id ? "-active" : ""}`}
            onClick={() => setPanel(t.id)}
            className={`px-3 py-2 text-sm font-body-ui whitespace-nowrap transition-colors ${
              panel === t.id ? "border-b-2 border-primary-container text-primary-container" : "text-system-log hover:text-primary"
            }`}
          >{t.label}</button>
        ))}
      </div>
      <div className="flex-1 p-4 overflow-y-auto text-sm font-body-narrative text-system-log">
        {content}
      </div>
    </div>
  );
}
