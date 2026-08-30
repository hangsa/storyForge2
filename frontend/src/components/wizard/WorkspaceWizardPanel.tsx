import { useEffect } from "react";
import api, { Concept, StoryDNA, World, CharacterSet, NovelOutline, Outline } from "../../api/client";
import { WizardProvider, useWizard, TOTAL_STEPS, type WizardData } from "./WizardContext";
import WizardSidebar from "./WizardSidebar";
import ConceptStep from "./ConceptStep";
import WorldStep from "./WorldStep";
import CharacterStep from "./CharacterStep";
import MapStep from "./MapStep";
import OutlineStep from "./OutlineStep";
import ChapterOutlineStep from "./ChapterOutlineStep";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import RegenerateStatusBadge from "./RegenerateStatusBadge";

interface Props { projectId: string }

const STEP_TITLES: Record<number, string> = {
  1: "创意发散", 2: "概念 DNA", 3: "世界观", 4: "角色设计",
  5: "地图系统", 6: "全文大纲", 7: "章节大纲",
};

function hasContent(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).some((x) => {
    if (x === null || x === undefined || x === "") return false;
    if (Array.isArray(x) && x.length === 0) return false;
    if (typeof x === "object" && Object.keys(x as object).length === 0) return false;
    return true;
  });
}

export default function WorkspaceWizardPanel({ projectId }: Props) {
  return (
    <WizardProvider projectId={projectId}>
      <Inner projectId={projectId} />
    </WizardProvider>
  );
}

function Inner({ projectId }: Props) {
  const wizard = useWizard();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cd, concept, world, chars, novel, outline] = await Promise.allSettled([
          api.getCreativeDivergencePrefill(projectId),
          api.getConcept(projectId),
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const completed: number[] = [];
        const data: Partial<WizardData> = {};
        if (cd.status === "fulfilled" && cd.value.exists) {
          completed.push(1);
          // We don't have variant list here; the step component will reload
        }
        const conceptPayload = concept.status === "fulfilled" ? concept.value : null;
        if (conceptPayload && hasContent(conceptPayload)) {
          completed.push(2);
          const c = (conceptPayload as { concept?: Concept }).concept;
          const dna = (conceptPayload as { story_dna?: StoryDNA }).story_dna;
          if (c) data.concept = c;
          if (dna) data.story_dna = dna;
        }
        if (world.status === "fulfilled" && hasContent(world.value)) { completed.push(3); data.world = world.value as World; }
        if (chars.status === "fulfilled" && hasContent(chars.value)) { completed.push(4); data.characters = chars.value as CharacterSet; }
        if (novel.status === "fulfilled" && hasContent(novel.value)) { completed.push(6); data.novel_outline = novel.value as NovelOutline; }
        if (outline.status === "fulfilled" && hasContent(outline.value)) { completed.push(7); data.chapter1_outline = outline.value as Outline; }
        if (completed.length > 0) wizard.hydrateFromFiles(completed, data);
        else wizard.markPrefillComplete();
      } catch {
        if (!cancelled) wizard.markPrefillComplete();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="flex" style={{ minHeight: "calc(100vh - 64px)" }}>
      <WizardSidebar currentStep={wizard.currentStep} completedSteps={wizard.completedSteps}
                     onJump={(s) => wizard.jumpToStep(s)} />

      <div className="flex-1 flex flex-col bg-background min-w-0">
        <header className="flex items-center justify-between px-margin-desktop h-12 border-b border-outline-variant shrink-0">
          <h1 className="font-display text-primary text-lg">
            初始化向导 · <span className="text-primary-container">{STEP_TITLES[wizard.currentStep] ?? ""}</span>
          </h1>
          <span className="text-on-surface-variant text-xs">步骤 {wizard.currentStep} / {TOTAL_STEPS}</span>
        </header>

        <main className="flex-1 overflow-y-auto pt-xl px-margin-desktop pb-xl flex justify-center">
          <div className="w-full max-w-[800px] flex flex-col gap-lg">
            {wizard.currentStep === 1 && <CreativeDivergenceStep projectId={projectId} />}
            {wizard.currentStep === 2 && <ConceptStep projectId={projectId} />}
            {wizard.currentStep === 3 && <WorldStep projectId={projectId} />}
            {wizard.currentStep === 4 && <CharacterStep projectId={projectId} />}
            {wizard.currentStep === 5 && <MapStep />}
            {wizard.currentStep === 6 && <OutlineStep projectId={projectId} />}
            {wizard.currentStep === 7 && (
              <ChapterOutlineStep projectId={projectId} onFinish={() => { /* WorkspacePage handles tab switch */ }} />
            )}
          </div>
        </main>

        <footer className="flex items-center justify-between px-margin-desktop py-3 border-t border-outline-variant gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button data-testid="wizard-prev" type="button"
                    onClick={() => wizard.jumpToStep(Math.max(1, wizard.currentStep - 1))}
                    disabled={wizard.currentStep === 1}
                    className="px-4 py-2 text-sm bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-low disabled:opacity-40">
              上一步
            </button>
            {wizard.regenerateState.kind !== "idle" && (
              <RegenerateStatusBadge state={wizard.regenerateState} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {wizard.regenerateHandler && (
              <button data-testid="wizard-regenerate" type="button" onClick={wizard.regenerateHandler}
                      disabled={wizard.regenerateDisabled}
                      className="px-4 py-2 text-sm bg-surface-container text-on-surface-variant rounded-lg hover:bg-surface-container-low disabled:opacity-40">
                重新生成
              </button>
            )}
            {wizard.saveHandler && (
              <button data-testid="wizard-save" type="button" onClick={wizard.saveHandler}
                      disabled={wizard.saveDisabled}
                      className="px-4 py-2 text-sm bg-surface-container text-primary rounded-lg hover:bg-surface-container-low disabled:opacity-40">
                保存修改
              </button>
            )}
            {wizard.nextHandler && (
              <button data-testid="wizard-next" type="button" onClick={wizard.nextHandler}
                      disabled={wizard.nextDisabled}
                      className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40">
                确认修改并继续
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
