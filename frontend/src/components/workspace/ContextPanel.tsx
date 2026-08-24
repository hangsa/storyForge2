import { useEffect, useState } from "react";
import api, { type NovelOutline } from "../../api/client";
import { useWorkspacePanel, type WorkspacePanel } from "../../hooks/useWorkspacePanel";
import ConceptEditor from "./editors/ConceptEditor";
import WorldEditor from "./editors/WorldEditor";
import CharacterEditor from "./editors/CharacterEditor";
import NovelOutlineEditor from "./editors/NovelOutlineEditor";
import ChapterOutlineEditor from "./editors/ChapterOutlineEditor";
import DiagnosisSummary from "./DiagnosisSummary";
import ExportSummary from "./ExportSummary";

interface Props {
  projectId: string;
  readOnly?: boolean;
  readOnlyReason?: string;
}

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}

/** Tabs 1-4 (concept/world/character/outline) host in-place editors. The
 *  "大纲" tab in v1.9 shows the NOVEL-level outline (核心冲突 / 全卷划分 /
 *  主角成长弧线 / 关键剧情点) — chapter-by-chapter outlines live in the
 *  left panel (ChapterTreePanel). Tabs 5-6 (diagnosis/export) show their
 *  read+action summary components and keep Stage5/6 as secondary actions. */
const TAB_LABEL: Record<WorkspacePanel, string> = {
  concept: "概念",
  world: "世界观",
  character: "角色",
  outline: "大纲",
  "chapter-outline": "章节大纲",
  diagnosis: "诊断",
  export: "导出",
};

const FETCHER: Record<WorkspacePanel, (id: string) => Promise<unknown>> = {
  concept: (id) => api.getConcept(id),
  world: (id) => api.getWorld(id),
  character: (id) => api.getCharacter(id),
  outline: (id) => api.getNovelOutline(id),
  "chapter-outline": (id) => api.getOutline(id),
  diagnosis: async () => ({}),
  export: async () => ({}),
};

// The chapter-outline editor groups chapter rows by volume, so it needs the
// novel-level outline (volumes + chapter_range) in addition to the per-chapter
// outline. We fetch both in parallel and bundle them so the editor can render
// volume headers without doing its own data fetches. Other panels fetch only
// what their editor needs.
async function fetchChapterOutlineBundle(projectId: string): Promise<{
  outline: unknown;
  novelOutline: unknown;
}> {
  const [outline, novelOutline] = await Promise.all([
    api.getOutline(projectId),
    api.getNovelOutline(projectId).catch(() => null),
  ]);
  return { outline, novelOutline };
}

export default function ContextPanel({ projectId, readOnly, readOnlyReason }: Props) {
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
    const fetcher = panel === "chapter-outline"
      ? () => fetchChapterOutlineBundle(projectId)
      : () => FETCHER[panel](projectId);
    fetcher()
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
      {readOnly && readOnlyReason && (
        <div
          data-testid="context-readonly-banner"
          className="px-4 py-2 bg-secondary-container/30 border-b border-outline-variant text-xs font-body-ui text-system-log"
        >
          <span className="font-label-mono text-[10px] uppercase tracking-wider mr-2">只读</span>
          {readOnlyReason}
        </div>
      )}
      <div className="flex-1 p-4 overflow-y-auto text-sm font-body-narrative text-system-log space-y-3">
        {panel === "concept" || panel === "world" || panel === "character" || panel === "outline" || panel === "chapter-outline" ? (
          loading ? (
            <p data-testid={`context-loading-${panel}`} className="font-body-ui text-system-log text-sm">加载中…</p>
          ) : (
            <EditorForPanel panel={panel} projectId={projectId} data={data} onSaved={refresh} readOnly={readOnly} />
          )
        ) : panel === "diagnosis" ? (
          <DiagnosisSummary projectId={projectId} />
        ) : (
          <ExportSummary projectId={projectId} />
        )}
      </div>
    </div>
  );
}

function EditorForPanel({
  panel, projectId, data, onSaved, readOnly,
}: { panel: "concept" | "world" | "character" | "outline" | "chapter-outline" } & BaseEditorProps) {
  if (panel === "concept") return <ConceptEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "world") return <WorldEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "character") return <CharacterEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "outline") return <NovelOutlineEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  // chapter-outline receives a bundled { outline, novelOutline } so the
  // editor can group chapter rows by their owning volume. See
  // fetchChapterOutlineBundle above. The novelOutline cast treats anything
  // weird (missing file, partial schema) as null — the editor falls back to
  // a single "未分组" section in that case.
  const bundle = (data ?? null) as { outline?: unknown; novelOutline?: unknown } | null;
  const novelOutline = (bundle?.novelOutline ?? null) as NovelOutline | null;
  return (
    <ChapterOutlineEditor
      projectId={projectId}
      data={bundle?.outline}
      novelOutline={novelOutline}
      onSaved={onSaved}
      readOnly={readOnly}
    />
  );
}
