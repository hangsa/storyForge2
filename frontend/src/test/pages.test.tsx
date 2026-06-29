import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
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
    getCharacter: vi.fn().mockResolvedValue({}),
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
          <Route path="/project/:projectId/stage1" element={ui} />
          <Route path="/project/:projectId/stage2" element={ui} />
          <Route path="/project/:projectId/stage4" element={ui} />
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
});

describe("Stage3Page", () => {
  it("renders title and default novel-outline tab", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    expect(screen.getByText("情节头脑风暴")).toBeInTheDocument();
    expect(screen.getByText("AI 生成全书大纲")).toBeInTheDocument();
  });

  it("renders three sub-tabs: novel outline / outline / branches", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    // The first matching div.flex.items-center.gap-1 is the sub-tab row
    // rendered by Stage3Layout, before any panel content.
    const tabRow = document.querySelector("div.flex.items-center.gap-1")!;
    const tabButtons = tabRow.querySelectorAll("button");
    expect(tabButtons).toHaveLength(3);
    expect(tabButtons[0].textContent).toContain("全书大纲");
    expect(tabButtons[1].textContent).toContain("大纲视图");
    expect(tabButtons[2].textContent).toContain("分支模拟");
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
    const tabRow = document.querySelector("div.flex.items-center.gap-1")!;
    const outlineTabBtn = tabRow.querySelectorAll("button")[1];
    act(() => {
      outlineTabBtn.click();
    });
    expect(screen.getByText("生成大纲")).toBeInTheDocument();
  });

  it("shows banner on chapter outline tab when novel outline is missing", () => {
    renderWithRouter("/project/test-project/stage3", <></>);
    const tabRow = document.querySelector("div.flex.items-center.gap-1")!;
    const outlineTabBtn = tabRow.querySelectorAll("button")[1];
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
