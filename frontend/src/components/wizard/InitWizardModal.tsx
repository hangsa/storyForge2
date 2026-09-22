// DEPRECATED — replaced by <WorkspaceWizardPanel> in 2026-08-30 (spec §3.3).
// The init wizard now lives inside /project/:id/workspace?tab=settings; this
// file is kept only so legacy test files (ChapterOutlineStep.test.tsx,
// CharacterStep.behavior_examples.test.tsx) keep compiling. Do NOT mount
// this component from any active route.
//
// 2026-09-19 砍掉概念DNA 步骤(原 step 2)后,本 modal 的 step 1 改为渲染
// CreativeDivergenceStep(原 ConceptStep 已删除)。Step 编号统一 -1。

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api, { World, CharacterSet, MapPayload, NovelOutline, Outline } from "../../api/client";
import { useWizard, WizardProvider, type WizardData } from "./WizardContext";
import WizardSteps from "./WizardSteps";
import WorldStep from "./WorldStep";
import CharacterStep from "./CharacterStep";
import MapStep from "./MapStep";
import OutlineStep from "./OutlineStep";
import ChapterOutlineStep from "./ChapterOutlineStep";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import RegenerateStatusBadge from "./RegenerateStatusBadge";

interface InitWizardModalProps {
  projectId: string;
  /** Called when the wizard finishes or the user closes the modal. */
  onDismiss: () => void;
  /**
   * When true, the modal resumes an in-progress initialization: after the
   * prefill marks steps completed from the persisted files, the modal jumps
   * to the next uncompleted step. Used by the `/project/:id/wizard` deep
   * link so an INIT-stage book opens at the latest stage the user reached.
   * Defaults to false (fresh start — HomePage create flow).
   */
  resume?: boolean;
}

// 2026-09-19:step 1 改回"创意发散"(原 ConceptStep 已删除,改用 CreativeDivergenceStep)。
// 下游步骤 -1:世界观 2 / 角色 3 / 地图 4 / 全书大纲 5 / 章节大纲 6。
const STEP_TITLES: Record<number, string> = {
  1: "创意发散",
  2: "世界观",
  3: "角色设计",
  4: "地图系统",
  5: "全书大纲",
  6: "章节大纲",
};

function hasContent(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Object.values(o).some((x) => {
    if (x === null || x === undefined || x === "") return false;
    // Empty array / object means the section is in its default/empty state,
    // not actually filled in. Without this guard, the wizard prefill marks
    // 角色设计 + 全书大纲 as completed for fresh projects — the backend
    // returns {"characters": [], "current": {}} and {"chapters": []} as the
    // "no content yet" payload, and `[]`/`{}` pass a naive truthy check.
    if (Array.isArray(x) && x.length === 0) return false;
    if (typeof x === "object" && Object.keys(x as object).length === 0) return false;
    return true;
  });
}

export default function InitWizardModal({ projectId, onDismiss, resume = false }: InitWizardModalProps) {
  return (
    <WizardProvider projectId={projectId}>
      <InitWizardModalInner projectId={projectId} onDismiss={onDismiss} resume={resume} />
    </WizardProvider>
  );
}

function InitWizardModalInner({ projectId, onDismiss, resume }: InitWizardModalProps) {
  const wizard = useWizard();
  const navigate = useNavigate();

  // Best-effort deep-link resume: fetch the project's persisted files and
  // mark steps completed via hydrateFromFiles. hydrateFromFiles is additive
  // — a step the user just completed locally wins over the file fetch
  // (see WizardContext.test.tsx "is additive" test).
  //
  // v1.8.2: prefill ALWAYS runs on mount, even when sessionStorage already
  // holds a partial wizard state. The proj_cc4ca4ae regression showed that
  // sessionStorage can be stale (user closed on step 5 before clicking
  // "确认修改并继续", so data.novel_outline was null even though the file
  // existed on disk). Skipping prefill in that case caused OutlineStep's
  // auto-trigger to fire and regenerate content the user already paid for.
  //
  // 2026-09-19:不再拉 /concept-and-dna — 概念DNA 步骤已砍。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [world, chars, map, novel, outline] = await Promise.allSettled([
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getMap(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const completed: number[] = [];
        const data: Partial<WizardData> = {};
        if (world.status === "fulfilled" && hasContent(world.value)) {
          completed.push(2);
          data.world = world.value as World;
        }
        if (chars.status === "fulfilled" && hasContent(chars.value)) {
          completed.push(3);
          data.characters = chars.value as CharacterSet;
        }
        // Step 4 = map.json(地图系统,默认向后兼容 — 老项目无 map 也 OK)
        if (map.status === "fulfilled" && hasContent(map.value)) {
          completed.push(4);
          data.map = map.value as MapPayload;
        }
        if (novel.status === "fulfilled" && hasContent(novel.value)) {
          completed.push(5);
          data.novel_outline = novel.value as NovelOutline;
        }
        if (outline.status === "fulfilled" && hasContent(outline.value)) {
          completed.push(6);
          data.chapter1_outline = outline.value as Outline;
        }
        if (completed.length > 0) {
          if (resume) {
            const targetStep = Math.max(...completed);
            wizard.hydrateFromFilesAndAdvance(completed, data, targetStep);
          } else {
            wizard.hydrateFromFiles(completed, data);
          }
        } else {
          wizard.markPrefillComplete();
        }
      } catch {
        if (!cancelled) wizard.markPrefillComplete();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const finishWizard = async () => {
    try {
      await api.advance(projectId, "STAGE4");
    } catch {
      // proceed even if advance fails (mirrors HomePage create behavior)
    }
    wizard.reset();
    navigate(`/project/${encodeURIComponent(projectId)}/workspace`);
    onDismiss();
  };

  return (
    <div
      data-testid="init-wizard-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h1 className="font-display text-primary text-lg">
            初始化向导 · <span className="text-primary-container">{STEP_TITLES[wizard.currentStep]}</span>
          </h1>
          <button
            type="button"
            data-testid="wizard-close"
            onClick={onDismiss}
            aria-label="关闭向导（已保存进度）"
            title="已完成的步骤会自动保存，下次可从书架继续"
            className="text-on-surface-variant hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <WizardSteps
          currentStep={wizard.currentStep}
          completedSteps={wizard.completedSteps}
          onJump={(step) => wizard.jumpToStep(step)}
        />

        <main className="flex-1 overflow-y-auto px-6 py-4">
          {wizard.currentStep === 1 && (
            <CreativeDivergenceStep
              projectId={projectId}
              onAdvanceSuccess={() => wizard.markStepGenerated(1, {})}
            />
          )}
          {wizard.currentStep === 2 && <WorldStep projectId={projectId} />}
          {wizard.currentStep === 3 && <CharacterStep projectId={projectId} />}
          {wizard.currentStep === 4 && <MapStep />}
          {wizard.currentStep === 5 && <OutlineStep projectId={projectId} />}
          {wizard.currentStep === 6 && (
            <ChapterOutlineStep projectId={projectId} onFinish={finishWizard} />
          )}
        </main>

        <footer className="flex items-center justify-between px-6 py-4 border-t border-outline-variant gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              data-testid="wizard-prev"
              type="button"
              onClick={() => wizard.jumpToStep(Math.max(1, wizard.currentStep - 1))}
              disabled={wizard.currentStep === 1}
              className="px-4 py-2 text-sm bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-low disabled:opacity-40"
            >
              上一步
            </button>
            {wizard.regenerateState.kind !== "idle" && (
              <RegenerateStatusBadge state={wizard.regenerateState} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {wizard.regenerateHandler && (
              <button
                data-testid="wizard-regenerate"
                type="button"
                onClick={wizard.regenerateHandler}
                disabled={wizard.regenerateDisabled}
                className="px-4 py-2 text-sm bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-low disabled:opacity-40"
              >
                重新生成
              </button>
            )}
            {wizard.saveHandler && (
              <button
                data-testid="wizard-save"
                type="button"
                onClick={wizard.saveHandler}
                disabled={wizard.saveDisabled}
                className="px-4 py-2 text-sm bg-surface-container text-primary rounded-lg hover:bg-surface-container-low disabled:opacity-40"
              >
                保存修改
              </button>
            )}
            {wizard.nextHandler && (
              <button
                data-testid="wizard-next"
                type="button"
                onClick={wizard.nextHandler}
                disabled={wizard.nextDisabled}
                className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                确认修改并继续
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}