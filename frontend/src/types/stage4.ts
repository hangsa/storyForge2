// Drawer tab enum + labels. Keep in one place so renaming a tab is a one-line change.
export type DrawerTab = "precheck" | "impact" | "exemption" | "sfLogSuggestions";

export const DRAWER_TAB_LABELS: Record<DrawerTab, string> = {
  precheck: "预检",
  impact: "影响",
  exemption: "豁免",
  sfLogSuggestions: "SF_LOG 建议",
};

// Magic numbers — kept out of component code so a single edit retunes UX.
export const EXEMPTION_INTENT_TRUNCATE_LEN = 60;
export const DRAWER_PEEK_HEIGHT_PX = 60;
export const DRAWER_EXPANDED_HEIGHT_PX = 360;
export const DRAWER_SLIDE_DURATION_MS = 200;
export const TOAST_AUTO_DISMISS_MS = 4000;
export const DRAWER_TABLIST_ID = "stage4-drawer-tablist";

// Exemption API status filter values. Mirrors backend default.
export const EXEMPTION_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export type ExemptionStatus = (typeof EXEMPTION_STATUS)[keyof typeof EXEMPTION_STATUS];
