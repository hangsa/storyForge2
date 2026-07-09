import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return actual;
});

vi.mock("../api/client", () => ({
  default: {
    generateConcept: vi.fn(),
    getConcept: vi.fn().mockResolvedValue({}),
    updateConcept: vi.fn(),
    advance: vi.fn(),
    generateWorld: vi.fn(),
    getWorld: vi.fn().mockResolvedValue({}),
    generateCharacter: vi.fn(),
    getCharacter: vi.fn().mockResolvedValue({ characters: [], current: null }),
    generateOutline: vi.fn(),
    getOutline: vi.fn().mockResolvedValue({}),
    getNovelOutline: vi.fn().mockResolvedValue({}),
    generateNovelOutline: vi.fn(),
    updateNovelOutline: vi.fn(),
    writeScene: vi.fn(),
    forcePass: vi.fn(),
    skipScene: vi.fn(),
    getStage4Progress: vi.fn(),
    getChapterReview: vi.fn().mockResolvedValue({}),
    growthWorkshopCheck: vi.fn().mockResolvedValue({
      character_id: "c1",
      warnings: [],
      checked_at: "2026-06-29T00:00:00Z",
    }),
    growthWorkshopAdjust: vi.fn().mockResolvedValue({ stages: [], warnings: [] }),
    growthWorkshopDiscuss: vi.fn().mockResolvedValue({
      answer: "mocked",
      suggestions: [],
      skipped_reason: undefined,
    }),
    styleSandboxPreview: vi.fn().mockResolvedValue({
      rendered_text: "",
      source_avg_length: 0,
      rendered_avg_length: 0,
      tokens_used: 0,
      skipped_reason: "no router",
    }),
    styleSandboxSave: vi.fn().mockResolvedValue({ name: "", path: "" }),
    styleSandboxListConfigs: vi.fn().mockResolvedValue({ configs: [] }),
    styleSandboxLoadConfig: vi.fn().mockResolvedValue({}),
  },
  DEFAULT_SANDBOX_PARAMS: {
    sentence: { avg_length_range: [15, 45], short_sentence_ratio: 0.3, paragraph_length_range: [80, 200] },
    dialogue: { ratio: 0.35, max_consecutive_lines: 6 },
    rhythm: { pacing_bpm: 300, scene_change_frequency: 0.5 },
    density: { description_ratio: 0.4, action_ratio: 0.3 },
    satisfaction: { satisfaction_beat_count: 5, suspense_hook_required: true },
  },
  ApiError: class extends Error {
    code: string;
    detail: Record<string, unknown>;
    constructor(code: string, message: string, detail?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.detail = detail || {};
    }
  },
}));

vi.mock("../hooks/useStage4Writing", () => ({
  useStage4Writing: () => ({
    state: {
      status: "idle",
      sceneNumber: 0,
      draftText: null,
      factGuardChecks: [],
      coherenceScore: 0,
      allPassed: false,
      parsedLogs: [],
      retryCount: 0,
      retryHints: null,
      circuitBreakerTriggered: false,
      compatibilityNote: null,
      error: null,
    },
    writeScene: vi.fn(),
    forcePass: vi.fn(),
    skipScene: vi.fn(),
    reset: vi.fn(),
  }),
}));

import Stage1Page from "../pages/Stage1Page";
import Stage2Page from "../pages/Stage2Page";
import Stage3Page from "../pages/Stage3Page";
import Stage4Page from "../pages/Stage4Page";
import StyleSandboxPage from "../pages/StyleSandboxPage";
import Stage1Layout from "../components/layout/Stage1Layout";
import Stage3Layout from "../components/layout/Stage3Layout";
import { ToastProvider } from "../hooks/useToast";

function renderWithRouter(initialRoute: string, ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/project/:projectId/stage3" element={<Stage3Layout />}>
          <Route index element={<Stage3Page initialTab="novel-outline" />} />
          <Route path="outline" element={<Stage3Page initialTab="outline" />} />
          <Route path="branches" element={<div>branches-page</div>} />
        </Route>
      </Routes>
      {ui}
    </MemoryRouter>,
  );
}

function renderPage(ui: React.ReactNode, path = "/project/test-project/stage1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/project/:projectId/stage1" element={<Stage1Layout />}>
            <Route index element={ui} />
          </Route>
          <Route path="/project/:projectId/stage2" element={ui} />
          <Route path="/project/:projectId/stage4" element={ui} />
          <Route path="/project/:projectId/style" element={ui} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Stage1Page", () => {
  it("renders title and empty state", () => {
    renderPage(<Stage1Page />);
    expect(screen.getByText("概念讨论")).toBeInTheDocument();
    expect(screen.getByText(/点击.*生成概念.*开始阶段 1/)).toBeInTheDocument();
  });

  it("renders generate button", () => {
    renderPage(<Stage1Page />);
    expect(screen.getByText("生成概念")).toBeInTheDocument();
  });

  it("renders both subtabs from the layout with the quick tab active", () => {
    renderPage(<Stage1Page />);
    const quickTab = screen.getByRole("button", { name: /快速生成/ });
    const canvasTab = screen.getByRole("button", { name: /创意画布/ });
    expect(quickTab).toBeInTheDocument();
    expect(canvasTab).toBeInTheDocument();
    // Quick tab is active (primary-container background)
    expect(quickTab.className).toMatch(/bg-primary-container/);
    // Canvas tab is inactive
    expect(canvasTab.className).not.toMatch(/bg-primary-container/);
  });

  it("renders the tab switcher in pill style matching STAGE2", () => {
    renderPage(<Stage1Page />);
    // The pill container has bg-surface-container + rounded-lg + p-1
    const quickTab = screen.getByRole("button", { name: /快速生成/ });
    const pill = quickTab.parentElement!;
    expect(pill.className).toMatch(/bg-surface-container/);
    expect(pill.className).toMatch(/rounded-lg/);
    expect(pill.className).toMatch(/p-1/);
  });
});

describe("Stage2Page", () => {
  it("renders title and tab switcher", () => {
    renderPage(<Stage2Page />);
    expect(screen.getByText("世界观与角色")).toBeInTheDocument();
    expect(screen.getByText("世界观")).toBeInTheDocument();
    expect(screen.getByText("角色设定")).toBeInTheDocument();
  });

  it("shows world empty state by default", () => {
    renderPage(<Stage2Page />);
    expect(screen.getByText("尚未生成世界观")).toBeInTheDocument();
  });

  it("switches to character tab", () => {
    renderPage(<Stage2Page />);
    act(() => {
      screen.getByRole("button", { name: /角色设定/ }).click();
    });
    expect(screen.getByText("尚未生成角色设定")).toBeInTheDocument();
  });

  it("renders the 成长工坊 tab in the tab switcher", () => {
    renderPage(<Stage2Page />);
    expect(screen.getByText("成长工坊")).toBeInTheDocument();
  });
});

describe("Stage3Page", () => {
  it("renders title and default novel-outline tab", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    expect(screen.getByText("情节头脑风暴")).toBeInTheDocument();
    expect(screen.getByText("AI 生成全书大纲")).toBeInTheDocument();
  });

  it("renders three sub-tabs: novel outline / outline / branches", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    // Stage3Layout's tab switcher is the unique pill container in the
    // document. Other buttons (e.g. "AI 生成全书大纲" inside NovelOutlinePanel)
    // also mention 全书大纲, so we scope to the pill to find the tabs.
    const pill = document.querySelector("div.flex.gap-1.bg-surface-container")!;
    const tabButtons = pill.querySelectorAll("button");
    expect(tabButtons).toHaveLength(3);
    expect(tabButtons[0].textContent).toContain("全书大纲");
    expect(tabButtons[1].textContent).toContain("大纲视图");
    expect(tabButtons[2].textContent).toContain("分支模拟");
  });

  it("renders the tab switcher in pill style matching STAGE2", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    const pill = document.querySelector("div.flex.gap-1.bg-surface-container")!;
    expect(pill.className).toMatch(/rounded-lg/);
    expect(pill.className).toMatch(/p-1/);
  });

  it("default tab is novel outline — shows novel-level panel", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    expect(screen.getByText("AI 生成全书大纲")).toBeInTheDocument();
    expect(
      screen.getByText(/尚未生成 — AI 将基于 STAGE2 的世界观和角色设计全书骨架/)
    ).toBeInTheDocument();
  });

  it("switches to chapter outline tab and renders generate button", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    const pill = document.querySelector("div.flex.gap-1.bg-surface-container")!;
    const outlineTabBtn = pill.querySelectorAll("button")[1];
    act(() => {
      outlineTabBtn.click();
    });
    expect(screen.getByText("生成大纲")).toBeInTheDocument();
  });

  it("shows banner on chapter outline tab when novel outline is missing", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    const pill = document.querySelector("div.flex.gap-1.bg-surface-container")!;
    const outlineTabBtn = pill.querySelectorAll("button")[1];
    act(() => {
      outlineTabBtn.click();
    });
    expect(
      screen.getByText(/建议先生成.+全书大纲.+以让后续章节与全本骨架保持一致/)
    ).toBeInTheDocument();
  });

  it("renders chapter outline content when on /stage3/outline", () => {
    renderWithRouter("/project/test-project/stage3/outline", <></>);
    expect(screen.getByText("生成大纲")).toBeInTheDocument();
  });
});

describe("Stage4Page", () => {
  it("renders title and idle state", () => {
    renderPage(<Stage4Page />);
    expect(screen.getByText("写作中心")).toBeInTheDocument();
    expect(screen.getByText("点击「开始写作」生成场景草稿")).toBeInTheDocument();
  });

  it("renders controls bar", () => {
    renderPage(<Stage4Page />);
    expect(screen.getByText("章节")).toBeInTheDocument();
    expect(screen.getByText("场景")).toBeInTheDocument();
    expect(screen.getByText("跳过场景")).toBeInTheDocument();
  });

  it("renders start writing button", () => {
    renderPage(<Stage4Page />);
    expect(screen.getByText("开始写作")).toBeInTheDocument();
  });
});

describe("StyleSandboxPage", () => {
  it("renders ParamSliders and the style sandbox section", async () => {
    renderPage(<StyleSandboxPage />, "/project/test-project/style");
    expect(screen.getByText("风格沙盒")).toBeInTheDocument();
    expect(screen.getByText("句长")).toBeInTheDocument();
    expect(screen.getByText("对白")).toBeInTheDocument();
    expect(screen.getByText(/参考文本（≥50 字）/)).toBeInTheDocument();
    expect(screen.getByText(/已保存配置/)).toBeInTheDocument();
  });
});
