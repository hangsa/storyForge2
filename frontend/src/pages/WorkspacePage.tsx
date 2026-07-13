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

export default function WorkspacePage({ projectId: projectIdProp }: { projectId?: string } = {}) {
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? params.projectId ?? "";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { mode, setMode } = useWorkspaceMode();
  const { setPanel } = useWorkspacePanel();

  const [projectName, setProjectName] = useState("加载中…");
  // v1.9: ManagedDashboard now subscribes to useAutopilotSession directly,
  // so this page no longer owns the autopilot on/off state. The
  // `currentTask` string below remains — it's still consumed by
  // ModeSwitchConfirmModal (Task 2.9 will replace that consumer).
  const [currentTask] = useState("生成第 7 章");

  const [chapters, setChapters] = useState<DashboardChapter[]>([
    { chapter_number: 1, status: "completed" },
    { chapter_number: 2, status: "completed" },
    { chapter_number: 3, status: "completed" },
    { chapter_number: 4, status: "writing" },
    { chapter_number: 5, status: "planned" },
    { chapter_number: 6, status: "planned" },
    { chapter_number: 7, status: "planned" },
  ]);
  const [manualChapters, setManualChapters] = useState<WorkspaceChapterNode[]>([
    { chapter_number: 1, title: "第一章", scenes: [{ scene_id: "1-1", title: "开场" }, { scene_id: "1-2", title: "发现" }] },
    { chapter_number: 2, title: "第二章", scenes: [{ scene_id: "2-1", title: "冲突" }] },
    { chapter_number: 4, title: "第四章", scenes: [{ scene_id: "4-1", title: "高潮" }] },
  ]);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [currentScene, setCurrentScene] = useState<string | null>("1-1");
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

  // Read ?chapter=N&scene=M from URL on mount. Falls back to current state
  // if values are out-of-range or invalid (spec § Error Handling).
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
  }, []);

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
        projectName={projectName}
        mode={mode}
        onModeChange={handleModeChange}
        // v1.9: ManagedDashboard now owns the on/off state via
        // useAutopilotSession, so WorkspacePage cannot derive `autopilotState`
        // locally any more. Task 2.8 will lift the real session reading into
        // WorkspaceTopBar. Until then the badge simply stays hidden.
        autopilotState={null}
      />

      <WorkspaceLayout
        mode={mode}
        left={
          mode === "managed" ? (
            <ManagedDashboard
              projectId={projectId}
              chapters={chapters}
              onChapterClick={onDashboardChapterClick}
              onAddChapter={() => setChapters((cs) => [...cs, { chapter_number: cs.length + 1, status: "planned" }])}
              onRefresh={() => {}}
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
              onAddChapter={() => setManualChapters((cs) => [...cs, { chapter_number: cs.length + 1, title: `第 ${cs.length + 1} 章`, scenes: [] }])}
              onRefresh={() => {}}
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
          mode === "managed" ? <ManagedAIControlPanel /> : <ContextPanel projectId={projectId} />
        }
      />

      <ModeSwitchConfirmModal
        open={confirmOpen}
        kind={confirmKind}
        chapterNumber={takeOverChapter ?? undefined}
        currentTask={currentTask}
        queueLength={3}
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
