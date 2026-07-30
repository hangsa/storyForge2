import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api, { NovelOutline } from "../api/client";
import { useWorkspaceMode } from "../hooks/useWorkspaceMode";
import { useWorkspacePanel } from "../hooks/useWorkspacePanel";
import { useToast } from "../hooks/useToast";
import { computePlannedTotal } from "../utils/outline";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import ChapterTreePanel, {
  type WorkspaceChapterNode,
  type WorkspaceVolumeGroup,
} from "../components/workspace/ChapterTreePanel";
import type { ChapterStatus } from "../types/chapter";
import WritingArea from "../components/workspace/WritingArea";
import ContextPanel from "../components/workspace/ContextPanel";
import ModeSwitchConfirmModal from "../components/workspace/ModeSwitchConfirmModal";
import ManagedStartModal, { type ManagedStartConfig } from "../components/workspace/ManagedStartModal";
import AutopilotMiddlePanel from "../components/workspace/AutopilotMiddlePanel";
import AddChaptersModal, { type AddChaptersProgress } from "../components/workspace/AddChaptersModal";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";

// Internal record for progress.json-derived chapter status. Kept local to
// this page (not exported) — the canonical `ChapterStatus` union lives in
// types/chapter.ts and is shared between ChapterTreePanel and ManagedDashboard.
interface ProgressChapterRow {
  chapter_number: number;
  status: ChapterStatus;
}

// Map progress.json's `status` field onto ChapterStatus.
// `in_progress` is the writer-side term; the panel surfaces it as "writing".
function mapProgressStatus(s: string): ChapterStatus {
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
  const { show } = useToast();

  const [projectName, setProjectName] = useState("加载中…");

  const [chapters, setChapters] = useState<ProgressChapterRow[]>([]);
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

  // 重新生成: when true, the user has chosen to proceed with regenerate
  // after the unsaved-changes confirm dialog.
  // v1.9: removed — RegenerateModal (rendered inside WritingArea) now
  // owns the confirm action. The unsaved-changes warning is rendered as
  // a placeholder hint inside the modal.

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"mode-switch" | "take-over">("mode-switch");
  const [takeOverChapter, setTakeOverChapter] = useState<number | null>(null);
  const [pendingTargetMode, setPendingTargetMode] = useState<"manual" | "managed" | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  // v1.9: AI 工具 dropdown opens the Prompt Plaza modal for THIS project
  // (not the most-recent project like the home page entry).
  const [plazaOpen, setPlazaOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);

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

  // chapterStatus: derived from the existing `chapters` array (already mapped
  // through mapProgressStatus into ChapterStatus). The ChapterStatus union is
  // closed (no defensive `as string` — if a new state is added upstream,
  // this memo will surface a TS error rather than silently rendering as
  // "planned"). This map is passed to <ChapterTreePanel> as an overlay in
  // BOTH manual and managed modes so the column shows the same status badges
  // regardless of mode.
  const chapterStatus = useMemo<Record<number, ChapterStatus>>(() => {
    const m: Record<number, ChapterStatus> = {};
    for (const c of chapters) {
      m[c.chapter_number] = c.status;
    }
    return m;
  }, [chapters]);

  // sceneStatus: keyed `${chapterNumber}-${sceneNumber}` (the existing
  // scene_id convention). Populated lazily when currentChapter changes or
  // the user clicks 刷新 (reloadKey++). Cache entries for other chapters
  // are preserved across switches.
  const [sceneStatus, setSceneStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getSceneDrafts(projectId, currentChapter)
      .then((r: { scenes: Array<{ scene_number: number; has_draft: boolean }> }) => {
        if (cancelled) return;
        setSceneStatus((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (k.startsWith(`${currentChapter}-`)) delete next[k];
          }
          for (const s of r.scenes ?? []) {
            next[`${currentChapter}-${s.scene_number}`] = s.has_draft;
          }
          return next;
        });
      })
      .catch(() => {
        // Failed fetch → silently clear current chapter's entries (matches
        // the existing "we don't know what's on disk" pattern). The UI
        // simply omits the scene-status dot for that chapter.
        if (cancelled) return;
        setSceneStatus((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (k.startsWith(`${currentChapter}-`)) delete next[k];
          }
          return next;
        });
      });
    return () => { cancelled = true; };
  }, [projectId, currentChapter, reloadKey]);

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

  // Load saved draft for the currently-selected chapter/scene. The
  // content is set even if it's empty (so the editor doesn't show stale
  // prose from a previous selection). When the user picks a chapter
  // with no saved draft yet, content is set to "". lastSavedContent
  // tracks the on-disk state so the regenerate confirm only fires when
  // the user has unsaved edits.
  useEffect(() => {
    if (!projectId) return;
    if (!currentScene) return;
    const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
    if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
    let cancelled = false;
    api
      .getSceneDraft(projectId, currentChapter, sceneNumber)
      .then((d: { draft_text?: string }) => {
        if (cancelled) return;
        const text = d?.draft_text ?? "";
        setContent(text);
        setLastSavedContent(text);
      })
      .catch(() => {
        if (cancelled) return;
        setContent("");
        setLastSavedContent("");
      });
    return () => { cancelled = true; };
  }, [projectId, currentChapter, currentScene]);

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
        const mapped: ProgressChapterRow[] = (p?.chapters ?? []).map((c) => ({
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

  const onDashboardChapterClick = (n: number, status: ChapterStatus) => {
    if (status === "writing") {
      setConfirmKind("take-over");
      setTakeOverChapter(n);
      setPendingTargetMode("manual");
      setConfirmOpen(true);
      return;
    }
    setCurrentChapter(n);
    const ch = manualChapters.find((c) => c.chapter_number === n);
    setCurrentScene(ch?.scenes[0]?.scene_id ?? null);
    setMode("manual");
    // v1.9 layer 3 fix: drilling into a completed/pending chapter also exits
    // managed mode, so the autopilot session must stop for the same reason
    // as the top-bar mode switch — see onConfirmDrillDown below.
    if (projectId) {
      void api.stopAutopilotSession(projectId).catch(() => {});
    }
  };

  const onConfirmDrillDown = (opts: { waitForCurrent: boolean; chapterNumber?: number }) => {
    setConfirmOpen(false);
    if (confirmKind === "take-over" && opts.chapterNumber != null) {
      if (!opts.waitForCurrent) {
        setCurrentChapter(opts.chapterNumber);
        const ch = manualChapters.find((c) => c.chapter_number === opts.chapterNumber);
        setCurrentScene(ch?.scenes[0]?.scene_id ?? null);
        setMode("manual");
        // v1.9 layer 3 fix: stopping the autopilot session when leaving
        // managed mode prevents a stale "state: running" / "current_task:
        // ..." from leaking into manual-mode UI (the topbar reads
        // session.current_task even when mode === "manual"). Fire-and-
        // forget — the UI doesn't need to wait, and a slow stop call
        // shouldn't block the user from editing.
        if (projectId) {
          void api.stopAutopilotSession(projectId).catch(() => {});
        }
      }
    } else {
      setMode("manual");
      // v1.9 layer 3 fix: same as above for the top-bar mode-switch path.
      if (projectId) {
        void api.stopAutopilotSession(projectId).catch(() => {});
      }
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

  const doRegenerate = async (sceneNumber: number, userModifications: string = "") => {
    setBusy(true);
    try {
      // v1.9: thread user_modifications through to /stage4/write-scene.
      // Empty string is equivalent to today's behavior (no user_modifications
      // block appended to the scene_writing prompt).
      const resp = await api.writeScene({
        project_id: projectId,
        chapter_number: currentChapter,
        scene_number: sceneNumber,
        user_modifications: userModifications,
      });
      if (resp.draft_text) {
        setContent(resp.draft_text);
        show("场景已重新生成");
      } else {
        show("场景生成完成（无草稿文本）");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      show(`重新生成失败：${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="workspace-page" className="h-screen flex flex-col bg-canvas-bg">
      <WorkspaceTopBar
        projectId={projectId}
        projectName={projectName}
        mode={mode}
        onModeChange={handleModeChange}
        onOpenPlaza={() => setPlazaOpen(true)}
        onOpenConsole={() => setConsoleOpen(true)}
      />

      <WorkspaceLayout
        mode={mode}
        left={
          // v1.9 T4: both modes now render the same <ChapterTreePanel />.
          // The only difference is `onAddChapter` — managed mode passes
          // undefined so the "+ 新章节" button is hidden (autopilot
          // manages chapter creation). The take-over decision (status
          // === "writing" → modal; otherwise drill into manual) lives
          // here, in the unified handler, since both modes share the
          // same status overlay.
          <ChapterTreePanel
            volumes={volumeGroups}
            currentChapter={currentChapter}
            currentScene={currentScene}
            chapterStatus={chapterStatus}
            sceneStatus={sceneStatus}
            onSelectChapter={(n) => onDashboardChapterClick(n, chapterStatus[n] ?? "pending")}
            onSelectScene={(n, s) => { setCurrentChapter(n); setCurrentScene(s); }}
            onAddChapter={mode === "managed" ? undefined : () => setAddOpen(true)}
            onRefresh={async () => {
              if (!projectId) return;
              try {
                const r = await api.repairProgress(projectId);
                if (r.repaired_chapters.length > 0) {
                  show(`已推进 ${r.repaired_chapters.length} 个章节`);
                }
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                show(`章节收尾失败：${msg}`);
              }
              setReloadKey((k) => k + 1);
            }}
          />
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
                  show("草稿已保存");
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  show(`保存失败：${msg}`);
                } finally {
                  setBusy(false);
                }
              }}
              onRegenerate={async (text: string) => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                // v1.9: RegenerateModal (rendered by WritingArea) collects
                // user_modifications and the confirm action. The unsaved-
                // changes warning is shown as a placeholder hint inside
                // the modal — hasUnsavedChanges prop wires that.
                await doRegenerate(sceneNumber, text);
              }}
              hasUnsavedChanges={content !== lastSavedContent}
              onFactGuard={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                setBusy(true);
                try {
                  // Read-only check — does NOT call /write-scene, does NOT
                  // overwrite the editor. Result is shown via toast.
                  const result = await api.factGuard({
                    project_id: projectId,
                    chapter_number: currentChapter,
                    scene_number: sceneNumber,
                    draft_text: content,
                  });
                  // User-friendly summary — hide internal check names; just
                  // report the failure count so the toast stays short.
                  if (result.all_passed) {
                    const n = result.checks.length;
                    show(n > 0 ? `Fact Guard 通过（${n} 项检查）` : "Fact Guard 通过");
                  } else {
                    const failed = result.checks.filter((c) => !c.passed).length;
                    show(`Fact Guard 未通过（${failed} 项不通过）`);
                  }
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  show(`Fact Guard 失败：${msg}`);
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
          <ContextPanel
            projectId={projectId}
            readOnly={mode === "managed"}
            readOnlyReason={mode === "managed" ? "托管运行中,元数据已锁定" : undefined}
          />
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
      {/* v1.9: regenerate unsaved-changes confirm dialog removed — the
          RegenerateModal (rendered inside WritingArea) now doubles as
          both the input collector and the confirm action. The unsaved-
          changes warning is rendered as a placeholder hint inside the
          modal via the hasUnsavedChanges prop. */}
      <PromptPlazaModal
        isOpen={plazaOpen}
        projectId={projectId}
        projectTitle={projectName === "加载中…" ? null : projectName}
        onClose={() => setPlazaOpen(false)}
      />
      <AIConsoleModal
        isOpen={consoleOpen}
        onClose={() => setConsoleOpen(false)}
      />
    </div>
  );
}
