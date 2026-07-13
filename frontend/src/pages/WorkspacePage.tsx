import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../api/client";
import { useWorkspaceMode } from "../hooks/useWorkspaceMode";
import { useWorkspacePanel } from "../hooks/useWorkspacePanel";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import ManagedDashboard, { type DashboardChapter } from "../components/workspace/ManagedDashboard";
import ManagedAIControlPanel from "../components/workspace/ManagedAIControlPanel";
import ChapterTreePanel, { type WorkspaceChapterNode } from "../components/workspace/ChapterTreePanel";
import WritingArea from "../components/workspace/WritingArea";
import ContextPanel from "../components/workspace/ContextPanel";
import ModeSwitchConfirmModal from "../components/workspace/ModeSwitchConfirmModal";
import ManagedStartModal, { type ManagedStartConfig } from "../components/workspace/ManagedStartModal";

// Map progress.json's `status` field onto ManagedDashboard's chapter status.
// `in_progress` is the writer-side term; the dashboard surfaces it as "writing".
function mapProgressStatus(s: string): DashboardChapter["status"] {
  if (s === "completed") return "completed";
  if (s === "in_progress") return "writing";
  if (s === "pending") return "planned";
  return "pending";
}

export default function WorkspacePage({ projectId: projectIdProp }: { projectId?: string } = {}) {
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? params.projectId ?? "";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { mode, setMode } = useWorkspaceMode();
  const { setPanel } = useWorkspacePanel();

  const [projectName, setProjectName] = useState("加载中…");

  const [chapters, setChapters] = useState<DashboardChapter[]>([]);
  const [manualChapters, setManualChapters] = useState<WorkspaceChapterNode[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [currentScene, setCurrentScene] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"mode-switch" | "take-over">("mode-switch");
  const [takeOverChapter, setTakeOverChapter] = useState<number | null>(null);
  const [pendingTargetMode, setPendingTargetMode] = useState<"manual" | "managed" | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  // Project name load — best-effort. 404 redirects to "/" per spec
  // § Error Handling. Anything else is silently swallowed (page still
  // renders with the default "加载中…" title).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getProjectStatus(projectId)
      .then((s: { title?: string }) => {
        if (!cancelled && s?.title) setProjectName(s.title);
      })
      .catch((err: { response?: { status?: number }; status?: number }) => {
        if (cancelled) return;
        if (err?.response?.status === 404 || err?.status === 404) {
          navigate("/", { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate]);

  // Read ?chapter=N&scene=M from URL on mount (and after the chapter tree
  // loads — `manualChapters` starts empty until getOutline resolves). Falls
  // back to current state if values are out-of-range or invalid (spec §
  // Error Handling).
  useEffect(() => {
    const chParam = Number(searchParams.get("chapter"));
    const scParam = searchParams.get("scene");
    if (!Number.isFinite(chParam) || chParam < 1) return;
    const ch = manualChapters.find((c) => c.chapter_number === chParam);
    if (!ch) return;
    setCurrentChapter(chParam);
    if (scParam && ch.scenes.some((s) => s.scene_id === scParam)) {
      setCurrentScene(scParam);
    } else {
      setCurrentScene(ch.scenes[0]?.scene_id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualChapters]);

  // Load managed-mode chapter list (with status) from progress.json.
  // Backend get_progress returns { chapters: [] } when progress.json does not
  // exist (e.g. brand-new project) — no special-case needed here, the empty
  // list is the correct "nothing to show" state.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getStage4Progress(projectId)
      .then((p: { chapters?: Array<{ chapter_number: number; status: string }> }) => {
        if (cancelled) return;
        const mapped: DashboardChapter[] = (p?.chapters ?? []).map((c) => ({
          chapter_number: c.chapter_number,
          status: mapProgressStatus(c.status),
        }));
        setChapters(mapped);
      })
      .catch(() => {
        // 404 / network error → leave list empty (the UI shows no cells, which
        // is the truthful state for "we don't know what's on disk")
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  // Load manual-mode chapter tree from outline.json. scene_id is derived as
  // ${chapter_number}-${scene_number} (the existing UI convention). Backend
  // get_outline returns 404 if outline.json does not exist; treat that the
  // same as a successful empty payload.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getOutline(projectId)
      .then((o: {
        chapters?: Array<{
          chapter_number: number;
          title: string;
          scene_plan?: Array<{ scene_number: number }>;
        }>;
      }) => {
        if (cancelled) return;
        const mapped: WorkspaceChapterNode[] = (o?.chapters ?? []).map((c) => ({
          chapter_number: c.chapter_number,
          title: c.title || `第 ${c.chapter_number} 章`,
          scenes: (c.scene_plan ?? []).map((s) => ({
            scene_id: `${c.chapter_number}-${s.scene_number}`,
            title: `场景 ${c.chapter_number}-${s.scene_number}`,
          })),
        }));
        setManualChapters(mapped);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const handleModeChange = (next: "managed" | "manual") => {
    if (next === mode) return;
    if (mode === "managed" && next === "manual") {
      setConfirmKind("mode-switch");
      setPendingTargetMode("manual");
      setConfirmOpen(true);
      return;
    }
    if (mode === "manual" && next === "managed") {
      setPendingTargetMode("managed");
      setStartOpen(true);
      return;
    }
    setMode(next);
  };

  const onDashboardChapterClick = (n: number, status: DashboardChapter["status"]) => {
    if (status === "writing") {
      setConfirmKind("take-over");
      setTakeOverChapter(n);
      setPendingTargetMode("manual");
      setConfirmOpen(true);
      return;
    }
    setCurrentChapter(n);
    setMode("manual");
  };

  const onConfirmDrillDown = (opts: { waitForCurrent: boolean; chapterNumber?: number }) => {
    setConfirmOpen(false);
    if (confirmKind === "take-over" && opts.chapterNumber != null) {
      if (!opts.waitForCurrent) {
        setCurrentChapter(opts.chapterNumber);
        const ch = manualChapters.find((c) => c.chapter_number === opts.chapterNumber);
        setCurrentScene(ch?.scenes[0]?.scene_id ?? null);
        setMode("manual");
      }
    } else {
      setMode("manual");
    }
    setTakeOverChapter(null);
    setPendingTargetMode(null);
  };

  const goToOutlinePanel = () => {
    setPanel("outline");
  };

  return (
    <div data-testid="workspace-page" className="h-screen flex flex-col bg-canvas-bg">
      <WorkspaceTopBar
        projectId={projectId}
        projectName={projectName}
        mode={mode}
        onModeChange={handleModeChange}
      />

      <WorkspaceLayout
        mode={mode}
        left={
          mode === "managed" ? (
            <ManagedDashboard
              projectId={projectId}
              chapters={chapters}
              onChapterClick={onDashboardChapterClick}
              // No-op: there is no backend endpoint to add a chapter outside the
              // outline workflow. Refresh re-fetches the real list.
              onAddChapter={() => {}}
              onRefresh={() => setReloadKey((k) => k + 1)}
            />
          ) : (
            <ChapterTreePanel
              chapters={manualChapters}
              currentChapter={currentChapter}
              currentScene={currentScene}
              onSelectChapter={(n) => {
                setCurrentChapter(n);
                const ch = manualChapters.find((c) => c.chapter_number === n);
                setCurrentScene(ch?.scenes[0]?.scene_id ?? null);
                setContent("");
              }}
              onSelectScene={(n, s) => { setCurrentChapter(n); setCurrentScene(s); }}
              onAddChapter={() => {}}
              onRefresh={() => setReloadKey((k) => k + 1)}
            />
          )
        }
        center={
          mode === "manual" ? (
            <WritingArea
              current={(() => {
                const ch = manualChapters.find((c) => c.chapter_number === currentChapter);
                const sc = ch?.scenes.find((s) => s.scene_id === currentScene);
                if (!ch || !sc) return null;
                return {
                  chapter_number: ch.chapter_number,
                  chapter_title: ch.title,
                  scene_id: sc.scene_id,
                  scene_title: sc.title,
                  outline_summary: "(占位)",
                };
              })()}
              content={content}
              onContentChange={setContent}
              onSaveDraft={async () => {
                setBusy(true);
                try {
                  await api.updateOutline(
                    projectId,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    { chapters: [{ chapter_number: currentChapter, title: "", scene_plan: [{ scene_id: currentScene ?? "", content }] }] } as any,
                  );
                } catch {
                  // swallow — UI scaffolding only, v1.8 has no toast layer yet
                } finally {
                  setBusy(false);
                }
              }}
              onRegenerate={async () => { setBusy(true); setBusy(false); }}
              onFactGuard={async () => { setBusy(true); setBusy(false); }}
              busy={busy}
              onNavigateToOutline={goToOutlinePanel}
            />
          ) : null
        }
        right={
          mode === "managed" ? <ManagedAIControlPanel projectId={projectId} /> : <ContextPanel projectId={projectId} />
        }
      />

      <ModeSwitchConfirmModal
        open={confirmOpen}
        kind={confirmKind}
        chapterNumber={takeOverChapter ?? undefined}
        projectId={projectId}
        plannedChapters={chapters.filter((c) => c.status !== "completed").length}
        onCancel={() => { setConfirmOpen(false); setTakeOverChapter(null); setPendingTargetMode(null); }}
        onConfirm={onConfirmDrillDown}
      />
      <ManagedStartModal
        open={startOpen}
        onCancel={() => { setStartOpen(false); setPendingTargetMode(null); }}
        onStart={(_cfg: ManagedStartConfig) => { setStartOpen(false); setMode("managed"); setPendingTargetMode(null); }}
      />
    </div>
  );
}
