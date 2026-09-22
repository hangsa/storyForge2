import { useEffect, useState } from "react";
import api, { World, CharacterSet, NovelOutline, Outline } from "../../api/client";
import { WizardProvider, useWizard, type WizardData } from "./WizardContext";
import WizardSidebar from "./WizardSidebar";
import WorldStep from "./WorldStep";
import CharacterStep from "./CharacterStep";
import MapStep from "./MapStep";
import OutlineStep from "./OutlineStep";
import ChapterOutlineStep from "./ChapterOutlineStep";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import PlotCanvasMountPoint from "../plot-canvas/PlotCanvasMountPoint";
import RegenerateStatusBadge from "./RegenerateStatusBadge";

interface Props { projectId: string }

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
  // 2026-09-22: divergence 实际完成(cdPayload.selected_at || conceptHasContent)
  // 但 wizard.completedSteps 不含 1 时(旧 sessionStorage 持久化空数组),
  // sidebar 仍允许跳回 Step 1 查看 divergence 内容。forceReachableSteps
  // 是 WizardSidebar 接受的位置数组,语义"额外强制可达"。
  const [forceReachableSteps, setForceReachableSteps] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 2026-09-21:prefill 重新拉 /concept-and-dna 作为 divergence 完成的
        // fallback 信号 — selected_at 在 proj_f0721bdc 之前的项目是 null,
        // commit 中途中断的项目也可能没写入。concept_and_dna.json 存在
        // 内容即可证明 divergence 已 commit 过。
        const [cd, concept, canvasState, world, chars, novel, outline] = await Promise.allSettled([
          api.getCreativeDivergence(projectId),
          api.getConcept(projectId),
          api.getCanvasV2State(projectId),
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const completed: number[] = [];
        const data: Partial<WizardData> = {};

        // Divergence completion: selected_at is the primary source of
        // truth (both source="canvas" and source="creative_divergence"
        // dual-write at /commit). proj_f0721bdc 2026-08-31 regression.
        // Fallback: if selected_at is missing (pre-dual-write project or
        // commit partially failed) but concept_and_dna.json has content,
        // divergence was effectively completed — still mark step 1 done.
        // 2026-09-21 修「step 2 点击左侧创意发散无响应」。
        const cdPayload = cd.status === "fulfilled" ? cd.value : null;
        const conceptPayload = concept.status === "fulfilled" ? concept.value : null;
        const conceptHasContent = conceptPayload != null && hasContent(conceptPayload.concept);
        const divergenceDone = (cdPayload && cdPayload.selected_at) || conceptHasContent;
        if (divergenceDone) {
          completed.push(1);
        }

        // Plot canvas completion: committed is the semantic signal;
        // committed_at !== null is a defensive backstop ensuring both
        // flags agree on read (the backend stamps both atomically today,
        // but defense-in-depth for disk-derived signals). Marks step 5
        // (剧情画布) as completed; divergence and canvas are independent steps.
        const canvasPayload = canvasState.status === "fulfilled" ? canvasState.value : null;
        if (canvasPayload?.committed === true && canvasPayload.committed_at !== null) {
          completed.push(5);
        }

        // 2026-09-19 步骤编号统一 -1(world 3→2 / chars 4→3 / novel 7→6 /
        // outline 8→7),与 WizardSidebar SIDEBAR_ITEMS 同步。Step 5 仍是 MapStep
        // 占位(无数据)。
        if (world.status === "fulfilled" && hasContent(world.value)) { completed.push(2); data.world = world.value as World; }
        if (chars.status === "fulfilled" && hasContent(chars.value)) { completed.push(3); data.characters = chars.value as CharacterSet; }
        if (novel.status === "fulfilled" && hasContent(novel.value)) { completed.push(6); data.novel_outline = novel.value as NovelOutline; }
        if (outline.status === "fulfilled" && hasContent(outline.value)) { completed.push(7); data.chapter1_outline = outline.value as Outline; }

        if (completed.length > 0) {
          wizard.hydrateFromFiles(completed, data);
        } else {
          wizard.markPrefillComplete();
        }
        // divergenceDone 时把 Step 1 标为额外可达,即使 completedSteps
        // 不含 1(旧 sessionStorage 持久化空数组)也让 sidebar 可点击。
        if (divergenceDone) {
          setForceReachableSteps((prev) => (prev.includes(1) ? prev : [...prev, 1]));
        }
      } catch {
        if (!cancelled) wizard.markPrefillComplete();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="flex" style={{ minHeight: "calc(100vh - 64px)" }}>
      <WizardSidebar
        currentStep={wizard.currentStep}
        completedSteps={wizard.completedSteps}
        forceReachableSteps={forceReachableSteps}
        onJump={(item) => {
          wizard.jumpToStep(item.position);
        }}
      />

      <div className="flex-1 flex flex-col bg-background min-w-0">
        <main className="flex-1 overflow-y-auto">
          <div className="w-full h-full flex flex-col">
            {wizard.currentStep === 1 && (
              <CreativeDivergenceStep
                projectId={projectId}
                onAdvanceSuccess={() => {
                  wizard.markStepGenerated(1, {});
                  wizard.jumpToStep(2);
                }}
              />
            )}
            {wizard.currentStep === 2 && <WorldStep projectId={projectId} />}
            {wizard.currentStep === 3 && <CharacterStep projectId={projectId} />}
            {wizard.currentStep === 4 && <MapStep projectId={projectId} />}
            {wizard.currentStep === 5 && <PlotCanvasMountPoint projectId={projectId} />}
            {wizard.currentStep === 6 && <OutlineStep projectId={projectId} />}
            {wizard.currentStep === 7 && (
              <ChapterOutlineStep projectId={projectId} onFinish={() => { /* WorkspacePage handles tab switch */ }} />
            )}
          </div>
        </main>

        <footer className="flex items-center justify-between px-6 py-3 border-t border-outline-variant gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button data-testid="wizard-prev" type="button"
                    onClick={() => {
                      // Sub-stage back-nav (S2 inside wizard step 1) takes
                      // precedence over step-level back-nav. The divergence
                      // wizard registers `prevHandler` for the S2 sub-stage;
                      // on S1 / when no handler is registered we fall back
                      // to the wizard-step level jump. S1 itself never
                      // registers a prevHandler, so this falls through and
                      // the button disables (currentStep === 1).
                      if (wizard.prevHandler) {
                        wizard.prevHandler();
                        return;
                      }
                      wizard.jumpToStep(Math.max(1, wizard.currentStep - 1));
                    }}
                    disabled={wizard.currentStep === 1 && wizard.prevHandler === null}
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
              <button data-testid="wizard-next" type="button" onClick={wizard.nextLoadingClickHandler ?? wizard.nextHandler}
                      disabled={wizard.nextDisabled && !wizard.nextLoadingClickHandler}
                      className="px-5 py-2 bg-tertiary-container text-surface-container-low text-sm rounded-lg hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2">
                {wizard.nextDisabled && wizard.nextLoadingLabel
                  ? wizard.nextLoadingLabel
                  : wizard.nextLabel
                    ? wizard.nextLabel
                    : wizard.currentStep === 1
                      ? "下一步:拆解 →"
                      : "下一步:世界观 →"}
                {wizard.nextDisabled && wizard.nextLoadingLabel && !wizard.nextLoadingClickHandler && (
                  <span className="material-symbols-outlined text-base leading-none animate-spin">progress_activity</span>
                )}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}