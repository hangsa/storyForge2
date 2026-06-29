import type { DrawerTab } from "./types/stage4";

interface DrawerCounts {
  precheck: number;
  impact: number;
  exemption: number;
  sfLogSuggestions: number;
}

export const uiStrings = {
  drawer: {
    peekHint: (counts: DrawerCounts): string =>
      `共 ${counts.precheck + counts.impact + counts.exemption + counts.sfLogSuggestions} 项待处理`,
  },
  precheck: {
    empty: "本次写作无需补充标记",
    skippedPrefix: "预检已跳过：",
  },
  impact: {
    run: "分析影响",
    rerun: "重新分析",
    viewFull: "查看完整报告",
    topCount: 3,
  },
  exemption: {
    empty: "暂无待审批的创意豁免请求",
    refresh: "刷新",
    approve: "通过",
    reject: "拒绝",
    rejectReasonLabel: "拒绝原因",
    antipatternLoading: "加载类似意图历史…",
    antipatternWarning: (n: number): string => `⚠ ${n} 次类似意图被拒绝`,
  },
  sfLog: {
    empty: "编辑草稿并保存后，会在此处显示建议",
    deletedSection: "已删除的 SF_LOG 标记",
    suggestedSection: "建议添加的 SF_LOG 标记",
    insertOne: "插入",
    insertAll: "全部插入",
  },
  errors: {
    loadFailedPrefix: "加载失败：",
    analyzeFailedPrefix: "分析失败：",
    applyFailedPrefix: "应用失败：",
  },
  toasts: {
    precheckReady: (n: number): string => `${n} 条预检建议已就绪`,
    suggestionsReady: (n: number): string => `${n} 条 SF_LOG 建议已就绪`,
  },
} as const;
