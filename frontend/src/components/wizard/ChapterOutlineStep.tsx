import { useEffect, useRef, useState } from "react";
import api, { NovelOutline, Outline } from "../../api/client";
import { computeFirstVolumeEnd, computePlannedTotal } from "../../utils/outline";
import { runWithGuardRetry } from "../../utils/outlineGuardRetry";
import { useWizard } from "./WizardContext";
import { RegenerateModal } from "../shared/RegenerateModal";

interface ChapterOutlineStepProps {
  projectId: string;
  /** Invoked after the outline is saved. Modal passes advance+navigate here. */
  onFinish: () => void;
}

/** Fallback when novel_outline has no parseable Volume 1 (degenerate
 *  novel outline / pre-step-5 project). v1.8.3 used this same number as
 *  the primary default; v2.1 promoted Volume 1's chapter count to the
 *  primary default and demoted this to the fallback path. */
const DEFAULT_OUTLINE_CHAPTERS_FALLBACK = 10;

/**
 * v2.1: default scope for chapter-outline auto-generation = the chapter
 * count in Volume 1 (parsed from `novel_outline.volumes[0].chapter_range`).
 * The wizard bulk-generates one volume at a time; later volumes are
 * produced via the workspace cockpit once Volume 1 is written.
 *
 * Capped by the planned total (max end across valid volumes) so a
 * malformed Volume 2+ range can't stretch the batch past Volume 1's
 * authoritatively scoped endpoint. Falls back to
 * DEFAULT_OUTLINE_CHAPTERS_FALLBACK when Volume 1 is missing/unparseable.
 */
function computeOutlineScope(novelOutline: NovelOutline | null): number {
  const first = computeFirstVolumeEnd(novelOutline);
  if (first > 0) {
    const planned = computePlannedTotal(novelOutline);
    return planned > 0 ? Math.min(first, planned) : first;
  }
  const planned = computePlannedTotal(novelOutline);
  return planned > 0
    ? Math.min(DEFAULT_OUTLINE_CHAPTERS_FALLBACK, planned)
    : DEFAULT_OUTLINE_CHAPTERS_FALLBACK;
}

export default function ChapterOutlineStep({ projectId, onFinish }: ChapterOutlineStepProps) {
  const wizard = useWizard();
  const [outline, setOutline] = useState<Outline | null>(wizard.data.chapter1_outline ?? null);
  const [busy, setBusy] = useState(false);
  // Batch progress (chapter 1..N in flight). null when idle. Kept in state
  // so the loading UI can show "第 X / N 章" without a global refetch.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // v2.1: per-chapter retry attempt counter for the FORBIDDEN_TERM_DETECTED
  // guard. Reset to 1 at the start of each chapter so the spinner shows
  // "正在生成章节大纲…" (attempt 1) and only prefixes "第N次" on retries.
  const [attempt, setAttempt] = useState(1);
  // v1.9: RegenerateModal opens when the user clicks the modal-footer's
  // "重新生成" button. The modal returns the typed modification string,
  // which is passed to every api.generateOutline call in the batch.
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  // v2.1: per-chapter regenerate. A non-null value means a RegenerateModal
  // is open targeting that specific chapter_number. Kept separate from
  // `showRegenerateModal` so the bulk-regen footer button and the
  // per-chapter card button don't fight over the same modal instance.
  const [perChapterRegen, setPerChapterRegen] = useState<{ chapterNumber: number } | null>(null);
  const [perChapterRegenBusy, setPerChapterRegenBusy] = useState(false);
  // Mirror latest state for handlers registered in the modal footer.
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  // v2.1: pause signal for the in-flight batch. Read by the loop's
  // post-iteration check; the in-flight chapter always finishes (so the
  // disk has a consistent outline.json) but the NEXT iteration is
  // skipped. Stored in a ref so the click doesn't have to wait for React
  // to commit the new state — the next iteration sees it immediately.
  const pauseRequestedRef = useRef(false);

  const handleStart = async (
    userModifications: string = "",
    fromChapter: number = 1,
  ) => {
    const scope = computeOutlineScope(wizard.data.novel_outline);
    wizard.startStep(6);
    setBusy(true);
    setProgress({ done: fromChapter - 1, total: scope });
    setAttempt(1);
    pauseRequestedRef.current = false;
    let latest: Outline | null = null;
    let paused = false;
    let lastDone = fromChapter - 1;
    try {
      // Sequential, not parallel: the backend's `/stage3/generate` reads
      // existing outline.json, removes any chapter with the same
      // chapter_number, appends the new one, and writes back. Parallel
      // calls would race on the same read-modify-write. The response is
      // the post-merge outline, so the form can render every chapter
      // generated so far while the batch is still running.
      for (let i = fromChapter; i <= scope; i++) {
        // Per-chapter guard retry: if the LLM leaks a forbidden term into
        // this chapter's outline, the backend 422s with the violation list;
        // runWithGuardRetry appends a feedback message and re-calls up to 3
        // times. The attempt counter drives the "第N次生成…" UI hint.
        const result = await runWithGuardRetry(
          (mods) => api.generateOutline(projectId, i, mods),
          userModifications,
          { onAttempt: (a) => setAttempt(a) },
        );
        latest = result;
        setOutline(result);
        setProgress({ done: i, total: scope });
        setAttempt(1);
        lastDone = i;
        // Pause check happens AFTER the in-flight chapter is persisted,
        // so outline.json stays consistent (no half-done state) and
        // `latest` always reflects an on-disk chapter count.
        if (pauseRequestedRef.current) {
          paused = true;
          break;
        }
      }
      setProgress({ done: lastDone, total: scope });
      if (paused) {
        // v2.1: save state so a later "继续生成" picks up from lastDone+1.
        // Drop status back to "idle" so the spinner stops and the form +
        // resume CTA can render — a "paused" step is no longer generating.
        // Do NOT mark the step completed; the batch isn't done.
        wizard.setStatus("idle");
        wizard.updateData({
          chapter_outline_progress: {
            done: lastDone,
            total: scope,
            last_user_modifications: userModifications,
          },
        });
      } else {
        // v1.8.4: mark generated so step 6 stays reachable in the indicator
        // when the user navigates away before clicking "完成 → 进入工作台".
        // Clear any prior paused-progress so a future "重新生成" starts
        // fresh from chapter 1 instead of resuming from the old position.
        wizard.markStepGenerated(6, {
          chapter1_outline: latest,
          chapter_outline_progress: null,
        });
      }
    } catch (e) {
      // Partial failure: the chapters that succeeded are already in
      // `outline` state and on disk (the backend wrote them). Surface
      // the failure so the user can retry from the footer. Persist the
      // partial progress so they can resume from where it stopped instead
      // of restarting from chapter 1 — pause and error are the same shape
      // from the resume-CTA's perspective.
      const partialDone = Math.max(progress?.done ?? 0, lastDone);
      wizard.updateData({
        chapter_outline_progress: {
          done: partialDone,
          total: scope,
          last_user_modifications: userModifications,
        },
      });
      wizard.setStatus(
        "error",
        e instanceof Error ? e.message : `章节大纲生成失败（第 ${progress?.done ?? 0}/${scope} 章）`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePause = () => {
    // The in-flight chapter call (if any) keeps running; the loop's
    // post-iteration check breaks the loop on the next boundary so the
    // disk stays consistent. Status flips to "idle" inside handleStart
    // when the break actually fires — not here — so the spinner keeps
    // showing during the brief "waiting for in-flight chapter" window.
    pauseRequestedRef.current = true;
  };

  // Resume from disk. The "done" count comes from the chapters on disk
  // (outline.json is the source of truth — survives crashes/refreshes);
  // wizard.data.chapter_outline_progress only contributes the
  // user_modifications re-applied on the resumed batch. The
  // "重新生成" footer button (when present) is the path to start over
  // from chapter 1 instead.
  const handleContinue = () => {
    if (!outline || outline.chapters.length === 0) return;
    const total = computeFirstVolumeEnd(wizard.data.novel_outline) ||
      DEFAULT_OUTLINE_CHAPTERS_FALLBACK;
    const done = outline.chapters.reduce(
      (m, c) => Math.max(m, c.chapter_number || 0),
      0,
    );
    if (done >= total) return;
    const savedMods =
      wizard.data.chapter_outline_progress?.last_user_modifications ?? "";
    setProgress({ done, total });
    void handleStart(savedMods, done + 1);
  };

  const updateChapterTitle = (idx: number, title: string) => {
    if (!outline) return;
    const chapters = outline.chapters.map((ch, i) => (i === idx ? { ...ch, title } : ch));
    setOutline({ ...outline, chapters });
  };

  // v2.1: per-chapter regenerate. Calls /stage3/regenerate-chapter-outline
  // with chapter_start = chapter_end = n. The API returns the FULL merged
  // outline (not just the regenerated chapter), so we replace local state
  // wholesale — same pattern as the bulk generateOutline path. We do NOT
  // touch wizard.data.chapter_outline_progress: that progress is for the
  // "继续生成" resume flow which is about a batch, not a single-chapter
  // refresh, and a single-chapter refresh shouldn't disturb that counter.
  const handleRegenerateOne = async (
    chapterNumber: number,
    userModifications: string,
  ) => {
    setPerChapterRegenBusy(true);
    try {
      const result = await api.regenerateChapterOutlineRange(
        projectId,
        chapterNumber,
        chapterNumber,
        userModifications,
      );
      setOutline({
        chapters: result.chapters as Outline["chapters"],
      });
      setPerChapterRegen(null);
    } catch (e) {
      wizard.setStatus(
        "error",
        e instanceof Error ? e.message : `第 ${chapterNumber} 章重新生成失败`,
      );
    } finally {
      setPerChapterRegenBusy(false);
    }
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

  const handleSave = async () => {
    const current = outlineRef.current;
    if (!current) return;
    setBusy(true);
    try {
      await api.updateOutline(projectId, current);
      wizard.markStepGenerated(6, { chapter1_outline: current });
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

  // 重新生成 / 保存修改 move to the modal footer. 完成 → 进入工作台 stays
  // in the form per current spec (not part of the 下一步/重新生成 rename).
  // The regenerate button is enabled for the form, the completed state,
  // and the error state so the user can recover from a generation failure.
  useEffect(() => {
    const hasOutline = !!outline && outline.chapters.length > 0;
    const canRegenerate =
      hasOutline ||
      wizard.status === "completed" ||
      wizard.status === "error";
    wizard.setRegenerateHandler(
      canRegenerate ? () => setShowRegenerateModal(true) : null,
      busy,
    );
    wizard.setSaveHandler(hasOutline ? handleSave : null, busy);
    return () => {
      wizard.setRegenerateHandler(null, false);
      wizard.setSaveHandler(null, false);
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
          <p className="font-body-ui text-primary-container mt-3 text-sm">
            正在
            <span data-testid="chapter-outline-attempt">
              {attempt > 1 ? `第${attempt}次` : ""}
            </span>
            生成章节大纲…
            {progress && (
              <span
                data-testid="chapter-outline-progress"
                className="ml-2 font-label-mono"
              >
                第 {progress.done} / {progress.total} 章
              </span>
            )}
          </p>
          {progress && progress.done < progress.total && (
            <button
              type="button"
              data-testid="chapter-outline-pause"
              onClick={handlePause}
              className="mt-4 px-4 py-1.5 text-xs border border-outline-variant rounded-lg
                         text-primary-container hover:bg-surface-container-low transition-colors"
            >
              暂停
            </button>
          )}
        </div>
      )}

      {wizard.status === "error" && (
        <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body-ui text-sm">
          {wizard.errorMessage}
        </div>
      )}

      {/* v2.1: Continue CTA. Persistent whenever Volume 1 has chapters
          left to generate — derives "done" from the chapters already on
          disk (so it works after a pause, a crash, or a refresh; the
          "重新生成" footer button remains the path to start from
          chapter 1 instead). Hidden during an in-flight batch since
          the spinner is the active UI, and hidden when the form
          hasn't rendered yet. */}
      {(() => {
        if (busy) return null;
        if (!outline || outline.chapters.length === 0) return null;
        const total = computeFirstVolumeEnd(wizard.data.novel_outline) ||
          DEFAULT_OUTLINE_CHAPTERS_FALLBACK;
        const done = outline.chapters.reduce(
          (m, c) => Math.max(m, c.chapter_number || 0),
          0,
        );
        if (done >= total) return null;
        const remaining = total - done;
        return (
          <div
            data-testid="chapter-outline-resume-banner"
            className="flex items-center justify-between gap-3 p-3 bg-tertiary-container/30 border border-primary-container/40 rounded-lg"
          >
            <p className="font-body-ui text-primary text-sm">
              已生成 <span className="font-label-mono">{done}</span> /{" "}
              <span className="font-label-mono">{total}</span> 章（第 1 卷），
              剩余 <span className="font-label-mono">{remaining}</span> 章未生成。
            </p>
            <button
              type="button"
              data-testid="chapter-outline-continue"
              onClick={handleContinue}
              className="px-4 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90"
            >
              继续生成
            </button>
          </div>
        );
      })()}

      {outline && outline.chapters.length > 0 && (
        <div data-testid="chapter-outline-form" className="space-y-3">
          <div className="font-label-mono text-primary-container text-sm">
            已生成 {outline.chapters.length} 章 ·{" "}
            {outline.chapters.reduce((acc, ch) => acc + (ch.scene_plan?.length ?? 0), 0)} 个场景
            {isPartialProgress && (
              <span
                data-testid="chapter-outline-partial-note"
                className="ml-2 text-primary-container"
              >
                （前 {progress!.total} 章中已完成 {progress!.done} 章）
              </span>
            )}
          </div>
          {outline.chapters.map((ch, idx) => {
            // Defensive: when the LLM emits a malformed first chapter (e.g.
            // the MiniMax-M3 think-block leak captured as
            // {"text": "", "degraded": true}), chapter_number / title /
            // scene_plan can all be missing. Without these guards the form
            // renders throw and the wizard tree unmounts — proj_1a7d7fcf
            // 2026-08-23: blank wizard page until the chapter was scrubbed.
            // We render a degraded badge instead of crashing so the user
            // can still see / edit the well-formed siblings and re-generate.
            if (
              typeof ch.chapter_number !== "number" ||
              typeof ch.title !== "string" ||
              !Array.isArray(ch.scene_plan)
            ) {
              return (
                <div
                  key={idx}
                  data-testid="chapter-outline-degraded"
                  className="border border-error/40 rounded-lg p-3 bg-error-container/10 space-y-2"
                >
                  <div className="font-body-ui text-error text-xs">
                    第 {idx + 1} 章解析异常（{(ch as { degraded?: boolean }).degraded ? "LLM 输出降级" : "字段缺失"}），已跳过渲染。
                  </div>
                  {/* idx+1 is the badge's display position — used as the
                      target chapter_number for the regenerate call. If the
                      degraded entry is real noise (no chapter_number on disk),
                      the API will generate a new chapter for that position
                      and the residual entry remains in the array (sorted to
                      chapter_number=0 default). Use the project's
                      outline.json scrub step to remove that residue. */}
                  <button
                    type="button"
                    data-testid="chapter-outline-degraded-regenerate"
                    onClick={() => setPerChapterRegen({ chapterNumber: idx + 1 })}
                    disabled={busy || perChapterRegenBusy}
                    className="px-3 py-1.5 text-xs border border-error/60 rounded-lg
                               text-error hover:bg-error-container/20
                               transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    重新生成该章
                  </button>
                </div>
              );
            }
            return (
              <div key={idx} className="border border-outline-variant rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <label className="font-label-mono text-primary-container text-sm whitespace-nowrap">
                    第 {ch.chapter_number} 章标题
                  </label>
                  <input
                    data-testid={`chapter-${ch.chapter_number}-title`}
                    value={ch.title}
                    onChange={(e) => updateChapterTitle(idx, e.target.value)}
                    className="flex-1 bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
                  />
                  <button
                    type="button"
                    data-testid={`chapter-${ch.chapter_number}-regenerate`}
                    onClick={() => setPerChapterRegen({ chapterNumber: ch.chapter_number })}
                    disabled={busy || perChapterRegenBusy}
                    className="px-3 py-2 text-xs border border-outline-variant rounded-lg
                               text-primary-container hover:bg-surface-container-low
                               transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    重新生成
                  </button>
                </div>
                <div className="font-body-ui text-primary-container text-[10px]">
                  {ch.scene_plan.length} 个场景
                </div>
              </div>
            );
          })}
          <p className="font-body-ui text-primary-container/60 text-xs">
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

      <RegenerateModal
        open={showRegenerateModal}
        target="章纲"
        onConfirm={async (text) => {
          setShowRegenerateModal(false);
          await handleStart(text);
        }}
        onCancel={() => setShowRegenerateModal(false)}
      />
      {/* v2.1: per-chapter regenerate modal. Separate instance from the
          bulk-regen modal above so the two flows can never overlap visually. */}
      <RegenerateModal
        open={perChapterRegen !== null}
        target={perChapterRegen ? `第 ${perChapterRegen.chapterNumber} 章` : ""}
        busy={perChapterRegenBusy}
        onConfirm={async (text) => {
          if (perChapterRegen) {
            await handleRegenerateOne(perChapterRegen.chapterNumber, text);
          }
        }}
        onCancel={() => {
          if (!perChapterRegenBusy) setPerChapterRegen(null);
        }}
      />
    </div>
  );
}