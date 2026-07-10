import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api, { Concept, StoryDNA, World, CharacterSet, NovelOutline, Outline } from "../../api/client";
import { useWizard, WizardProvider, type WizardData } from "./WizardContext";
import WizardSteps from "./WizardSteps";
import ConceptStep from "./ConceptStep";
import WorldStep from "./WorldStep";
import CharacterStep from "./CharacterStep";
import MapStep from "./MapStep";
import OutlineStep from "./OutlineStep";
import ChapterOutlineStep from "./ChapterOutlineStep";

interface InitWizardModalProps {
  projectId: string;
  /** Called when the wizard finishes; the modal also dismisses itself. */
  onDismiss: () => void;
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
  return Object.values(o).some((x) => x !== null && x !== undefined && x !== "");
}

export default function InitWizardModal({ projectId, onDismiss }: InitWizardModalProps) {
  return (
    <WizardProvider projectId={projectId}>
      <InitWizardModalInner projectId={projectId} onDismiss={onDismiss} />
    </WizardProvider>
  );
}

function InitWizardModalInner({ projectId, onDismiss }: InitWizardModalProps) {
  const wizard = useWizard();
  const navigate = useNavigate();

  // Best-effort deep-link resume: if no completed steps are loaded, fetch the
  // project's persisted files and mark steps completed via hydrateFromFiles.
  // hydrateFromFiles is additive — a step the user just completed locally
  // wins over the file fetch (see WizardContext.test.tsx "is additive" test).
  useEffect(() => {
    if (wizard.completedSteps.length > 0) return;
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
        if (novel.status === "fulfilled" && hasContent(novel.value)) {
          completed.push(4);
          data.novel_outline = novel.value as NovelOutline;
        }
        if (outline.status === "fulfilled" && hasContent(outline.value)) {
          completed.push(5);
          data.chapter1_outline = outline.value as Outline;
        }
        if (completed.length > 0) {
          wizard.hydrateFromFiles(completed, data);
        }
      } catch {
        // ignore prefill failures (e.g., 404 on first ever entry)
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
    onDismiss();
    navigate(`/project/${encodeURIComponent(projectId)}/workspace?mode=manual`);
  };

  return (
    <div
      data-testid="init-wizard-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h1 className="font-display text-primary text-lg">
            初始化向导 · <span className="text-system-log">{STEP_TITLES[wizard.currentStep]}</span>
          </h1>
          <button
            type="button"
            data-testid="wizard-close"
            disabled
            aria-label="关闭向导（不可关闭）"
            title="为防止数据丢失，向导运行期间不可关闭"
            className="text-system-log/40 cursor-not-allowed"
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

        {/* Footer intentionally has only "上一步": each step component owns
            its own forward action (next/save/finish). This avoids the duplicate
            "完成 → 进入工作台" buttons that previously appeared on step 6. */}
        <footer className="flex items-center justify-end px-6 py-4 border-t border-outline-variant">
          <button
            data-testid="wizard-prev"
            type="button"
            onClick={() => wizard.jumpToStep(Math.max(1, wizard.currentStep - 1))}
            disabled={wizard.currentStep === 1}
            className="px-4 py-2 text-sm bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
          >
            上一步
          </button>
        </footer>
      </div>
    </div>
  );
}