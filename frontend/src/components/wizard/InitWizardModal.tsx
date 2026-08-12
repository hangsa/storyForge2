import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api, { Concept, StoryDNA, World, CharacterSet, NovelOutline, Outline } from "../../api/client";
import { useWizard, WizardProvider, TOTAL_STEPS, type WizardData } from "./WizardContext";
import WizardSteps from "./WizardSteps";
import ConceptStep from "./ConceptStep";
import WorldStep from "./WorldStep";
import CharacterStep from "./CharacterStep";
import MapStep from "./MapStep";
import OutlineStep from "./OutlineStep";
import ChapterOutlineStep from "./ChapterOutlineStep";

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

const STEP_TITLES: Record<number, string> = {
  1: "概念讨论",
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [concept, world, chars, novel, outline] = await Promise.allSettled([
          api.getConcept(projectId),
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const completed: number[] = [];
        const data: Partial<WizardData> = {};
        const conceptPayload = concept.status === "fulfilled" ? concept.value : null;
        if (conceptPayload && hasContent(conceptPayload)) {
          completed.push(1);
          const c = (conceptPayload as { concept?: unknown }).concept as Concept | undefined;
          const dna = (conceptPayload as { story_dna?: unknown }).story_dna as StoryDNA | undefined;
          if (c) data.concept = c;
          if (dna) data.story_dna = dna;
        }
        if (world.status === "fulfilled" && hasContent(world.value)) {
          completed.push(2);
          data.world = world.value as World;
        }
        if (chars.status === "fulfilled" && hasContent(chars.value)) {
          completed.push(3);
          data.characters = chars.value as CharacterSet;
        }
        // Step mappings — must stay in sync with STEP_TITLES above:
        //   5 = novel_outline.json (全书大纲)
        //   6 = outline.json     (章节大纲 / chapter1_outline)
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
            // Land on the latest SAVED step, NOT the next one. Advancing
            // past the saved step put the user on a step whose data is
            // missing, which made that step's auto-trigger fire (e.g. saved
            // up to novel_outline → landed on ChapterOutlineStep → LLM call
            // to regenerate chapters the user had not asked for, 2026-08-09
            // bug report).
            const targetStep = Math.max(...completed);
            wizard.hydrateFromFilesAndAdvance(completed, data, targetStep);
          } else {
            wizard.hydrateFromFiles(completed, data);
          }
        } else {
          // No files to hydrate — still mark prefill complete so steps with
          // auto-triggers (OutlineStep etc.) can run their generation logic.
          wizard.markPrefillComplete();
        }
      } catch {
        // ignore prefill failures (e.g., 404 on first ever entry) but still
        // unblock auto-triggers so the user can proceed with a fresh project.
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
    // Navigate BEFORE onDismiss: if onDismiss ever does anything other than
    // `setState(null)` (e.g. window.location.assign, which fires a hard
    // reload), calling navigate first ensures the workspace URL wins.
    // WizardDeepLinkPage's previous window.location.assign("/") bug
    // manifested as "complete wizard → land on / instead of /workspace".
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
            className="text-system-log hover:text-primary transition-colors"
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
          {wizard.currentStep === 1 && <ConceptStep projectId={projectId} />}
          {wizard.currentStep === 2 && <WorldStep projectId={projectId} />}
          {wizard.currentStep === 3 && <CharacterStep projectId={projectId} />}
          {wizard.currentStep === 4 && <MapStep />}
          {wizard.currentStep === 5 && <OutlineStep projectId={projectId} />}
          {wizard.currentStep === 6 && (
            <ChapterOutlineStep projectId={projectId} onFinish={finishWizard} />
          )}
        </main>

        {/* Footer: 上一步 on the left; the current step's 重新生成 /
            保存修改 / 确认修改并继续 (registered via setRegenerateHandler /
            setSaveHandler / setNextHandler in WizardContext) on the right.
            保存修改 persists the current page content without advancing;
            确认修改并继续 persists AND advances. ChapterOutlineStep keeps
            its own "完成 → 进入工作台" inside the form for now. */}
        <footer className="flex items-center justify-between px-6 py-4 border-t border-outline-variant">
          <button
            data-testid="wizard-prev"
            type="button"
            onClick={() => wizard.jumpToStep(Math.max(1, wizard.currentStep - 1))}
            disabled={wizard.currentStep === 1}
            className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
          >
            上一步
          </button>
          <div className="flex items-center gap-2">
            {wizard.regenerateHandler && (
              <button
                data-testid="wizard-regenerate"
                type="button"
                onClick={wizard.regenerateHandler}
                disabled={wizard.regenerateDisabled}
                className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
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