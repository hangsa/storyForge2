/**
 * Material 3 utility-class strings for each stage's status chip.
 * Sourced from the Nebula Forge design spec. Consumers wrap in a className
 * picker (e.g. `STAGE_COLORS[stage] ?? STAGE_COLORS.INIT`) — there's no
 * "unknown stage" color by design (callers always have a stage string).
 */
export const STAGE_COLORS: Record<string, string> = {
  INIT:      "bg-surface-tint/20 text-surface-tint",
  STAGE1:    "bg-blue-500/20 text-blue-300",
  STAGE2:    "bg-purple-500/20 text-purple-300",
  STAGE3:    "bg-amber-500/20 text-amber-300",
  STAGE4:    "bg-primary-container/20 text-primary-container",
  STAGE5:    "bg-pink-500/20 text-pink-300",
  STAGE6:    "bg-emerald-500/20 text-emerald-300",
  COMPLETED: "bg-green-500/20 text-green-300",
};

export const STAGE_LABELS: Record<string, string> = {
  INIT:      "初始化",
  STAGE1:    "概念",
  STAGE2:    "世界观",
  STAGE3:    "大纲",
  STAGE4:    "工作台",
  STAGE5:    "诊断",
  STAGE6:    "导出",
  COMPLETED: "已完成",
};

/**
 * True when the project is still mid-init-wizard. Bookshelf uses this to
 * decide between re-opening the wizard modal (resume at next uncompleted
 * step) and dropping the user into the workspace at /stage1.
 *
 * STAGE4+ means the wizard has finished (user clicked "进入工作台" on step 6).
 */
export function isPreWizardStage(stage: string): boolean {
  return stage === "INIT" || stage === "STAGE1" || stage === "STAGE2" || stage === "STAGE3";
}

/**
 * 4 business-facing groups used by the sidebar's phase indicator, collapsing
 * the 8 backend stages into one row each per the Nebula Forge design.
 *
 * Mapping rationale:
 *   概念   — everything before chapter writing starts (INIT + STAGE1-3:
 *            init wizard, concept, world/character, outline)
 *   写作中 — the chapter-writing workspace (STAGE4)
 *   润色中 — post-writing review and export (STAGE5 + STAGE6)
 *   已完成 — finished projects (COMPLETED)
 */
export type BusinessGroup = "概念" | "写作中" | "润色中" | "已完成";

export const BUSINESS_GROUPS: BusinessGroup[] = ["概念", "写作中", "润色中", "已完成"];

const STAGE_TO_GROUP: Record<string, BusinessGroup> = {
  INIT: "概念",
  STAGE1: "概念",
  STAGE2: "概念",
  STAGE3: "概念",
  STAGE4: "写作中",
  STAGE5: "润色中",
  STAGE6: "润色中",
  COMPLETED: "已完成",
};

export function businessGroupOf(stage: string): BusinessGroup | null {
  return STAGE_TO_GROUP[stage] ?? null;
}