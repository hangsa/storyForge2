import { useEffect, useRef, useState } from "react";
import api, { NovelOutline, Outline } from "../../api/client";
import { useWizard } from "./WizardContext";

interface ChapterOutlineStepProps {
  projectId: string;
  /** Invoked after the outline is saved. Modal passes advance+navigate here. */
  onFinish: () => void;
}

/**
 * v1.8.3: default scope for chapter-outline auto-generation = first 10
 * chapters (≈ the leading third of a typical 30-chapter novel). Capped by
 * the user's planned total parsed from `novel_outline.json`'s volume
 * `chapter_range` strings. The strict regex format mirrors the backend
 * parser in backend/api/stage4_writing.py:647-681 — anything that fails
 * the regex (or a missing file) falls back to the default 10.
 */
const DEFAULT_OUTLINE_CHAPTERS = 10;
const CHAPTER_RANGE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

function computePlannedTotal(novelOutline: NovelOutline | null): number {
  if (!novelOutline?.volumes?.length) return 0;
  let maxEnd = 0;
  for (const v of novelOutline.volumes) {
    const m = CHAPTER_RANGE_RE.exec(v.chapter_range ?? "");
    if (!m) continue;
    const start = +m[1], end = +m[2];
    if (start < 1 || end < start) continue;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

function computeOutlineScope(novelOutline: NovelOutline | null): number {
  const planned = computePlannedTotal(novelOutline);
  return planned > 0 ? Math.min(DEFAULT_OUTLINE_CHAPTERS, planned) : DEFAULT_OUTLINE_CHAPTERS;
}

export default function ChapterOutlineStep({ projectId, onFinish }: ChapterOutlineStepProps) {
  const wizard = useWizard();
  const [outline, setOutline] = useState<Outline | null>(wizard.data.chapter1_outline ?? null);
  const [busy, setBusy] = useState(false);
  // Batch progress (chapter 1..N in flight). null when idle. Kept in state
  // so the loading UI can show "第 X / N 章" without a global refetch.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Mirror latest state for handlers registered in the modal footer.
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const handleStart = async () => {
    const scope = computeOutlineScope(wizard.data.novel_outline);
    wizard.startStep(6);
    setBusy(true);
    setProgress({ done: 0, total: scope });
    try {
      // Sequential, not parallel: the backend's `/stage3/generate` reads
      // existing outline.json, removes any chapter with the same
      // chapter_number, appends the new one, and writes back. Parallel
      // calls would race on the same read-modify-write. The response is
      // the post-merge outline, so the form can render every chapter
      // generated so far while the batch is still running.
      let latest: Outline | null = null;
      for (let i = 1; i <= scope; i++) {
        const result = await api.generateOutline(projectId, i);
        latest = result;
        setOutline(result);
        setProgress({ done: i, total: scope });
      }
      setProgress({ done: scope, total: scope });
      // v1.8.4: mark generated so step 6 stays reachable in the indicator
      // when the user navigates away before clicking "完成 → 进入工作台".
      // `latest` is the post-merge outline from the just-finished loop;
      // do NOT read outlineRef.current / outline here — React 18 batches
      // the final setOutline/setProgress with this dispatch, so the ref
      // would still hold the value from the previous render (outline with
      // 9 chapters, not 10). handleFinish will overwrite this with the
      // user's edited version via updateOutline + saveStep.
      wizard.markStepGenerated(6, { chapter1_outline: latest });
    } catch (e) {
      // Partial failure: the chapters that succeeded are already in
      // `outline` state and on disk (the backend wrote them). Surface
      // the failure so the user can retry from the footer.
      wizard.setStatus(
        "error",
        e instanceof Error ? e.message : `章节大纲生成失败（第 ${progress?.done ?? 0}/${scope} 章）`,
      );
    } finally {
      setBusy(false);
    }
  };

  const updateChapterTitle = (idx: number, title: string) => {
    if (!outline) return;
    const chapters = outline.chapters.map((ch, i) => (i === idx ? { ...ch, title } : ch));
    setOutline({ ...outline, chapters });
  };

  const handleFinish = async () => {
    const current = outlineRef.current;
    if (!current) return;
    setBusy(true);
    try {
      await api.updateOutline(projectId, current);
      wizard.saveStep(6, { chapter1_outline: current });
      onFinishRef.current();
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "章节大纲保存失败");
    } finally {
      setBusy(false);
    }
  };

  // Sync local `outline` state from wizard.data when prefill lands. Only
  // overwrite if local state is still null (no outline yet).
  useEffect(() => {
    const persisted = wizard.data.chapter1_outline;
    if (persisted && persisted.chapters.length > 0 && !outline) {
      setOutline(persisted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.data.chapter1_outline]);

  // Auto-trigger generation on first mount when there is no existing outline
  // and the wizard isn't already mid-run or in error. v1.8 drops the manual
  // "开始生成" button to match the other wizard steps.
  //
  // v1.8.2: wait for prefill to finish before deciding — same race-condition
  // fix as OutlineStep (proj_cc4ca4ae regression).
  useEffect(() => {
    if (!wizard.prefillComplete) return;
    if (
      !outline &&
      wizard.status !== "generating" &&
      wizard.status !== "error"
    ) {
      handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.prefillComplete]);

  // 重新生成 moves to the modal footer. 完成 → 进入工作台 stays in the
  // form per current spec (not part of the 下一步/重新生成 rename). The
  // regenerate button is enabled for the form, the completed state, and
  // the error state so the user can recover from a generation failure.
  useEffect(() => {
    const hasOutline = !!outline && outline.chapters.length > 0;
    const canRegenerate =
      hasOutline ||
      wizard.status === "completed" ||
      wizard.status === "error";
    wizard.setRegenerateHandler(canRegenerate ? handleStart : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!outline, outline?.chapters.length, busy]);

  const isPartialProgress =
    progress !== null && progress.done < progress.total;

  return (
    <div data-testid="chapter-outline-step" className="space-y-4">
      {wizard.status === "generating" && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
          <p className="font-body-ui text-system-log mt-3 text-sm">
            正在生成章节大纲…
            {progress && (
              <span
                data-testid="chapter-outline-progress"
                className="ml-2 font-label-mono"
              >
                第 {progress.done} / {progress.total} 章
              </span>
            )}
          </p>
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {outline && outline.chapters.length > 0 && (
        <div data-testid="chapter-outline-form" className="space-y-3">
          <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
            已生成 {outline.chapters.length} 章 ·{" "}
            {outline.chapters.reduce((acc, ch) => acc + ch.scene_plan.length, 0)} 个场景
            {isPartialProgress && (
              <span
                data-testid="chapter-outline-partial-note"
                className="ml-2 text-primary-container"
              >
                （前 {progress!.total} 章中已完成 {progress!.done} 章）
              </span>
            )}
          </div>
          {outline.chapters.map((ch, idx) => (
            <div key={idx} className="border border-outline-variant rounded-lg p-3 space-y-2">
              <label className="block font-label-mono text-system-log text-[10px] uppercase tracking-wider">
                第 {ch.chapter_number} 章标题
              </label>
              <input
                data-testid={`chapter-${ch.chapter_number}-title`}
                value={ch.title}
                onChange={(e) => updateChapterTitle(idx, e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              />
              <div className="font-body-ui text-system-log text-xs">
                {ch.scene_plan.length} 个场景 · 概要字数 {((ch as { summary?: string }).summary?.length ?? 0)}
              </div>
            </div>
          ))}
          <p className="font-body-ui text-system-log/60 text-xs">
            场景级详情可在工作台的大纲标签页内编辑。
          </p>
          <div className="flex justify-end pt-2">
            <button
              data-testid="chapter-outline-finish"
              onClick={handleFinish}
              disabled={busy}
              className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "保存中…" : "完成 → 进入工作台"}
            </button>
          </div>
          {/* 重新生成 moved to modal footer (see useEffect above). */}
        </div>
      )}
    </div>
  );
}