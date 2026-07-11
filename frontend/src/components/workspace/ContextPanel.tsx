import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";
import { useWorkspacePanel, type WorkspacePanel } from "../../hooks/useWorkspacePanel";

interface Props {
  projectId: string;
}

interface TabMeta {
  label: string;
  preview: (data: unknown) => string;
  linkTo: (projectId: string) => string;
}

const TAB_META: Record<WorkspacePanel, TabMeta> = {
  concept: {
    label: "概念",
    preview: (data: any) => {
      const c = data?.concept;
      if (!c) return "尚未填写概念";
      const lines = [c.title, c.genre, c.premise].filter(Boolean);
      return lines.join(" · ");
    },
    linkTo: (id) => `/project/${encodeURIComponent(id)}/stage1`,
  },
  world: {
    label: "世界观",
    preview: (data: any) => {
      if (!data?.era && !data?.era_social_structure) return "尚未填写世界观";
      return [data.era, data.era_social_structure, data.era_cultural_history].filter(Boolean).join(" · ");
    },
    linkTo: (id) => `/project/${encodeURIComponent(id)}/stage2`,
  },
  character: {
    label: "角色",
    preview: (data: any) => {
      const list = data?.characters ?? [];
      if (!Array.isArray(list) || list.length === 0) return "尚未创建角色";
      return list.slice(0, 5).map((c: any) => c.name || "未命名").join("、") + (list.length > 5 ? "…" : "");
    },
    linkTo: (id) => `/project/${encodeURIComponent(id)}/stage2`,
  },
  outline: {
    label: "大纲",
    preview: (data: any) => {
      const chs = data?.chapters ?? [];
      if (!Array.isArray(chs) || chs.length === 0) return "尚未生成大纲";
      return chs.slice(0, 3).map((c: any, i: number) => `${i + 1}. ${c.title || "(无标题)"}`).join("  ") + (chs.length > 3 ? "…" : "");
    },
    linkTo: (id) => `/project/${encodeURIComponent(id)}/stage3`,
  },
  diagnosis: {
    label: "诊断",
    preview: () => "v1.8 诊断功能由 Stage5 全屏提供",
    linkTo: (id) => `/project/${encodeURIComponent(id)}/stage5`,
  },
  export: {
    label: "导出",
    preview: () => "v1.8 导出功能由 Stage6 全屏提供",
    linkTo: (id) => `/project/${encodeURIComponent(id)}/stage6`,
  },
};

export default function ContextPanel({ projectId }: Props) {
  const { panel, setPanel } = useWorkspacePanel();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    const fetcher: Record<WorkspacePanel, () => Promise<unknown>> = {
      concept: () => api.getConcept(projectId),
      world: () => api.getWorld(projectId),
      character: () => api.getCharacter(projectId),
      outline: () => api.getOutline(projectId),
      diagnosis: () => Promise.resolve({}),
      export: () => Promise.resolve({}),
    };
    fetcher[panel]()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [panel, projectId]);

  return (
    <div data-testid="context-panel" className="h-full flex flex-col">
      <div className="flex border-b border-outline-variant overflow-x-auto">
        {(Object.keys(TAB_META) as WorkspacePanel[]).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`context-tab-${id}${panel === id ? "-active" : ""}`}
            onClick={() => setPanel(id)}
            className={`px-3 py-2 text-sm font-body-ui whitespace-nowrap transition-colors ${
              panel === id ? "border-b-2 border-primary-container text-primary-container" : "text-system-log hover:text-primary"
            }`}
          >{TAB_META[id].label}</button>
        ))}
      </div>
      <div className="flex-1 p-4 overflow-y-auto text-sm font-body-narrative text-system-log space-y-3">
        <div data-testid={`context-preview-${panel}`} className="whitespace-pre-wrap break-words">
          {loading ? "加载中…" : TAB_META[panel].preview(data) || "暂无数据"}
        </div>
        <Link
          to={TAB_META[panel].linkTo(projectId)}
          data-testid={`context-link-${panel}`}
          className="inline-flex items-center gap-1 text-primary-container hover:opacity-80 text-sm"
        >
          在完整页面编辑 <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}