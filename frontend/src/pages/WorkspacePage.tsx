import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api, { NovelOutline } from "../api/client";
import { useWorkspaceMode } from "../hooks/useWorkspaceMode";
import { useWorkspacePanel } from "../hooks/useWorkspacePanel";
import { computePlannedTotal } from "../utils/outline";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import ManagedDashboard, { type DashboardChapter } from "../components/workspace/ManagedDashboard";
import ManagedAIControlPanel from "../components/workspace/ManagedAIControlPanel";
import ChapterTreePanel, {
  type WorkspaceChapterNode,
  type WorkspaceVolumeGroup,
} from "../components/workspace/ChapterTreePanel";
import WritingArea from "../components/workspace/WritingArea";
import ContextPanel from "../components/workspace/ContextPanel";
import ModeSwitchConfirmModal from "../components/workspace/ModeSwitchConfirmModal";
import ManagedStartModal, { type ManagedStartConfig } from "../components/workspace/ManagedStartModal";
import AutopilotMiddlePanel from "../components/workspace/AutopilotMiddlePanel";
import AddChaptersModal, { type AddChaptersProgress } from "../components/workspace/AddChaptersModal";

// Map progress.json's `status` field onto ManagedDashboard's chapter status.
// `in_progress` is the writer-side term; the dashboard surfaces it as "writing".
function mapProgressStatus(s: string): DashboardChapter["status"] {
  if (s === "completed") return "completed";
  if (s === "in_progress") return "writing";
  if (s === "pending") return "planned";
  return "pending";
}

// Issue 3 (v1.9 follow-up): group chapters by volume using novel_outline's
// `volumes[].chapter_range` strings. Mirrors the parser in
// computePlannedTotal (frontend/src/utils/outline.ts) — same regex, same
// semantics. Chapters that don't fall into any volume (no novel_outline,
// or chapter_number above the last volume) end up in a single "未分组"
// tail group so the panel can still render them rather than hiding them.
const VOLUME_RANGE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

interface ParsedVolume {
  name: string;
  chapter_range: string;
  summary?: string;
  start: number;
  end: number;
}

function parseVolumes(novelOutline: NovelOutline | null): ParsedVolume[] {
  if (!novelOutline?.volumes?.length) return [];
  const out: ParsedVolume[] = [];
  for (const v of novelOutline.volumes) {
    const m = VOLUME_RANGE_RE.exec(v.chapter_range ?? "");
    if (!m) continue;
    const start = +m[1];
    const end = +m[2];
    if (start < 1 || end < start) continue;
    out.push({ name: v.name, chapter_range: v.chapter_range, summary: v.summary, start, end });
  }
  return out;
}

function groupChaptersByVolume(
  chapters: WorkspaceChapterNode[],
  novelOutline: NovelOutline | null,
): WorkspaceVolumeGroup[] {
  const parsed = parseVolumes(novelOutline);
  if (parsed.length === 0) {
    // No novel_outline or no parseable volumes — fall back to a single
    // ungrouped bucket so the tree is still navigable.
    return chapters.length === 0
      ? []
      : [{ name: "未分组", chapter_range: "", summary: undefined, chapters }];
  }
  const buckets: WorkspaceVolumeGroup[] = parsed.map((v) => ({
    name: v.name,
    chapter_range: v.chapter_range,
    summary: v.summary,
    chapters: [],
  }));
  const ungrouped: WorkspaceChapterNode[] = [];
  for (const ch of chapters) {
    const idx = parsed.findIndex((v) => ch.chapter_number >= v.start && ch.chapter_number <= v.end);
    if (idx === -1) {
      ungrouped.push(ch);
    } else {
      buckets[idx].chapters.push(ch);
    }
  }
  if (ungrouped.length > 0) {
    buckets.push({ name: "未分组", chapter_range: "", summary: undefined, chapters: ungrouped });
  }
  // Drop empty buckets — a volume with no chapters yet is still shown if
  // novel_outline declared it (so the user can see the planned range).
  // But ungrouped-by-range with 0 chapters is suppressed (we already
  // returned early for the no-outline case).
  return buckets.filter((b) => b.chapters.length > 0 || b.name !== "未分组");
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
  const [novelOutline, setNovelOutline] = useState<NovelOutline | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [currentScene, setCurrentScene] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  // Tracks the on-disk content for the currently-selected scene. Set
  // after a successful save and after a successful draft load (Task 4).
  // The dirty check `content !== lastSavedContent` decides whether the
  // regenerate confirm dialog should appear. length > 0 alone would fire
  // on every regenerate for chapters that already have a saved draft —
  // the common case for power users.
  const [lastSavedContent, setLastSavedContent] = useState<string>("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"mode-switch" | "take-over">("mode-switch");
  const [takeOverChapter, setTakeOverChapter] = useState<number | null>(null);
  const [pendingTargetMode, setPendingTargetMode] = useState<"manual" | "managed" | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  // Bug 1 fix: + 新章节 wiring. Modal state + progress; currentMaxChapter
  // drives the "starting from chapter N" hint inside the modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addProgress, setAddProgress] = useState<AddChaptersProgress | null>(null);
  const currentMaxChapter = useMemo(
    () => manualChapters.reduce((max, c) => Math.max(max, c.chapter_number), 0),
    [manualChapters],
  );
  const plannedTotal = useMemo(() => computePlannedTotal(novelOutline), [novelOutline]);
  // Issue 3: derive volume groups for ChapterTreePanel from manualChapters
  // + novel_outline. Recomputes when either input changes; falls back to a
  // single "未分组" group when novel_outline is missing.
  const volumeGroups = useMemo(
    () => groupChaptersByVolume(manualChapters, novelOutline),
    [manualChapters, novelOutline],
  );

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
    setChapters([]);  // clear stale data on every (re)load — on failure the
                      // UI shows the truthful "we don't know" empty state
                      // rather than presenting stale data as current
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
  // same as a successful empty payload. We surface the chapter's `theme`
  // and each scene's goal/conflict/emotional_arc/narrative_role/beat_type so
  // the WritingArea header can show real outline content above the editor
  // (was "(占位)" before Bug 2 fix).
  useEffect(() => {
    if (!projectId) return;
    setManualChapters([]);  // clear stale data on every (re)load — on failure
                            // the UI shows the truthful "we don't know"
                            // empty state rather than presenting stale data
    let cancelled = false;
    api
      .getOutline(projectId)
      .then((o: {
        chapters?: Array<{
          chapter_number: number;
          title: string;
          theme?: string;
          scene_plan?: Array<{
            scene_number: number;
            goal?: string;
            conflict?: string;
            emotional_arc?: string;
            narrative_role?: string;
            beat_type?: string;
          }>;
        }>;
      }) => {
        if (cancelled) return;
        const mapped: WorkspaceChapterNode[] = (o?.chapters ?? []).map((c) => ({
          chapter_number: c.chapter_number,
          title: c.title || `第 ${c.chapter_number} 章`,
          theme: c.theme,
          scenes: (c.scene_plan ?? []).map((s) => ({
            scene_id: `${c.chapter_number}-${s.scene_number}`,
            title: `场景 ${c.chapter_number}-${s.scene_number}`,
            goal: s.goal,
            conflict: s.conflict,
            emotional_arc: s.emotional_arc,
            narrative_role: s.narrative_role,
            beat_type: s.beat_type,
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

  // Load novel_outline.json so the + 新章节 modal can show a sensible cap.
  // Backend returns 404 on the first call when the project is brand new; we
  // treat that the same way as a missing/null payload (cap falls back to
  // a default in AddChaptersModal).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getNovelOutline(projectId)
      .then((o) => { if (!cancelled) setNovelOutline(o ?? null); })
      .catch(() => { if (!cancelled) setNovelOutline(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey]);

  const handleAddChapters = async (end: number) => {
    const start = currentMaxChapter + 1;
    const count = Math.max(0, end - currentMaxChapter);
    if (count === 0) return;
    setAddProgress({ done: 0, total: count });
    // Sequential (mirrors ChapterOutlineStep v1.8.3): /stage3/generate reads
    // existing outline.json, dedupes by chapter_number, appends the new one,
    // writes back. Parallel calls would race on the read-modify-write.
    try {
      for (let i = 1; i <= count; i++) {
        const next = start + i - 1;
        await api.generateOutline(projectId, next);
        setAddProgress({ done: i, total: count });
      }
      setAddOpen(false);
      setAddProgress(null);
      setReloadKey((k) => k + 1);
    } catch {
      // Leave the modal open with the partial progress so the user can
      // dismiss or retry; surface the failure via setStatus would
      // fight the wizard, so we just leave progress visible.
    }
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
              volumes={volumeGroups}
              currentChapter={currentChapter}
              currentScene={currentScene}
              onSelectChapter={(n) => {
                setCurrentChapter(n);
                const ch = manualChapters.find((c) => c.chapter_number === n);
                setCurrentScene(ch?.scenes[0]?.scene_id ?? null);
                setContent("");
              }}
              onSelectScene={(n, s) => { setCurrentChapter(n); setCurrentScene(s); }}
              onAddChapter={() => setAddOpen(true)}
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
                // Bug 2: show real outline content above the editor. v1.8
                // expansion: thread the chapter theme + scene goal/conflict/
                // emotional_arc through so the header can render them as
                // labeled rows instead of a single "占位" line. outline_summary
                // is kept for back-compat with the existing test.
                return {
                  chapter_number: ch.chapter_number,
                  chapter_title: ch.title,
                  chapter_theme: ch.theme,
                  scene_id: sc.scene_id,
                  scene_title: sc.title,
                  scene_goal: sc.goal,
                  scene_conflict: sc.conflict,
                  scene_emotional_arc: sc.emotional_arc,
                  scene_narrative_role: sc.narrative_role,
                  scene_beat_type: sc.beat_type,
                  outline_summary:
                    ch.theme?.trim() ||
                    sc.goal?.trim() ||
                    "",
                };
              })()}
              content={content}
              onContentChange={setContent}
              onSaveDraft={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  await api.updateSceneDraft({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                  setLastSavedContent(content);
                } catch {
                  // swallow — toast wiring lands in Task 6
                } finally {
                  setBusy(false);
                }
              }}
              onRegenerate={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  const resp = await api.writeScene({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                  });
                  if (resp.draft_text) {
                    setContent(resp.draft_text);
                  }
                } catch (e) {
                  console.warn("regenerate scene failed", e);
                } finally {
                  setBusy(false);
                }
              }}
              onFactGuard={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  // Read-only check — does NOT call /write-scene, does NOT
                  // overwrite the editor. Result is shown via toast (Task 6)
                  // and an inline summary in the future.
                  await api.factGuard({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                } catch {
                  // swallow — toast wiring lands in Task 6
                } finally {
                  setBusy(false);
                }
              }}
              busy={busy}
              onNavigateToOutline={goToOutlinePanel}
            />
          ) : (
            // v1.9: plotPilot alignment — managed mode centers on an
            // AutopilotWorkspace (cockpit/dashboard/log) instead of an
            // empty center column.
            <AutopilotMiddlePanel projectId={projectId} />
          )
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
        projectId={projectId}
        open={startOpen}
        onCancel={() => { setStartOpen(false); setPendingTargetMode(null); }}
        onStarted={() => { setStartOpen(false); setMode("managed"); setPendingTargetMode(null); }}
      />
      <AddChaptersModal
        open={addOpen}
        currentMax={currentMaxChapter}
        plannedTotal={plannedTotal}
        progress={addProgress}
        onCancel={() => {
          // Allow cancel only when no in-flight generation: protects
          // against abandoning a half-finished LLM batch.
          if (addProgress === null) setAddOpen(false);
        }}
        onConfirm={handleAddChapters}
      />
    </div>
  );
}
