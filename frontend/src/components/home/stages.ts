/**
 * True when the project is still mid-init-wizard. The bookshelf uses this to
 * decide between re-opening the wizard modal (resume at next uncompleted step)
 * and dropping the user into the workspace at /stage1.
 *
 * STAGE4+ means the wizard has finished (the user clicked "进入工作台" on step 6).
 * INIT / STAGE1 / STAGE2 / STAGE3 mean the user is somewhere before that point.
 */
export function isPreWizardStage(stage: string): boolean {
  return stage === "INIT" || stage === "STAGE1" || stage === "STAGE2" || stage === "STAGE3";
}