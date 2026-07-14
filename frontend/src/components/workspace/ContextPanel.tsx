import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client";
import { useWorkspacePanel, type WorkspacePanel } from "../../hooks/useWorkspacePanel";
import ConceptEditor from "./editors/ConceptEditor";
import WorldEditor from "./editors/WorldEditor";
import CharacterEditor from "./editors/CharacterEditor";
import OutlineEditor from "./editors/OutlineEditor";

interface Props {
  projectId: string;
}

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
}

/** Tabs 1-4 (concept/world/character/outline) now have in-place editors. Tabs
 *  5-6 (diagnosis/export) still defer to their full Stage pages because they
 *  expose dedicated flows (Stage5 evaluation + Stage6 export wizard) that the
 *  workspace panel can't host. The user's request was to fix tabs 1-4; tabs
 *  5-6 keep their existing layout + link. */
const TAB_LABEL: Record<WorkspacePanel, string> = {
  concept: "概念",
  world: "世界观",
  character: "角色",
  outline: "大纲",
  diagnosis: "诊断",
  export: "导出",
};

const FETCHER: Record<WorkspacePanel, (id: string) => Promise<unknown>> = {
  concept: (id) => api.getConcept(id),
  world: (id) => api.getWorld(id),
  character: (id) => api.getCharacter(id),
  outline: (id) => api.getOutline(id),
  diagnosis: async () => ({}),
  export: async () => ({}),
};

export default function ContextPanel({ projectId }: Props) {
  const { panel, setPanel } = useWorkspacePanel();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Bumping reloadKey tells the panel to re-fetch the current tab. Wired to
  // editor onSaved() callbacks so save→reload→form-rerender shows fresh data.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    FETCHER[panel](projectId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [panel, projectId, reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  return (
    <div data-testid="context-panel" className="h-full flex flex-col">
      <div className="flex border-b border-outline-variant overflow-x-auto">
        {(Object.keys(TAB_LABEL) as WorkspacePanel[]).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`context-tab-${id}${panel === id ? "-active" : ""}`}
            onClick={() => setPanel(id)}
            className={`px-3 py-2 text-sm font-body-ui whitespace-nowrap transition-colors ${
              panel === id ? "border-b-2 border-primary-container text-primary-container" : "text-system-log hover:text-primary"
            }`}
          >{TAB_LABEL[id]}</button>
        ))}
      </div>
      <div className="flex-1 p-4 overflow-y-auto text-sm font-body-narrative text-system-log space-y-3">
        {(panel === "concept" || panel === "world" || panel === "character" || panel === "outline") ? (
          loading ? (
            <p data-testid={`context-loading-${panel}`} className="font-body-ui text-system-log text-sm">加载中…</p>
          ) : (
            <EditorForPanel panel={panel} projectId={projectId} data={data} onSaved={refresh} />
          )
        ) : (
          // diagnosis / export: full-page links retained.
          <div className="space-y-3">
            <p data-testid={`context-preview-${panel}`} className="whitespace-pre-wrap break-words">
              v1.8 {TAB_LABEL[panel]}功能由 Stage{panel === "diagnosis" ? "5" : "6"} 全屏提供
            </p>
            <Link
              to={`/project/${encodeURIComponent(projectId)}/stage${panel === "diagnosis" ? "5" : "6"}`}
              data-testid={`context-link-${panel}`}
              className="inline-flex items-center gap-1 text-primary-container hover:opacity-80 text-sm"
            >
              在完整页面打开 <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function EditorForPanel({
  panel, projectId, data, onSaved,
}: { panel: "concept" | "world" | "character" | "outline" } & BaseEditorProps) {
  if (panel === "concept") return <ConceptEditor projectId={projectId} data={data} onSaved={onSaved} />;
  if (panel === "world") return <WorldEditor projectId={projectId} data={data} onSaved={onSaved} />;
  if (panel === "character") return <CharacterEditor projectId={projectId} data={data} onSaved={onSaved} />;
  return <OutlineEditor projectId={projectId} data={data} onSaved={onSaved} />;
}
