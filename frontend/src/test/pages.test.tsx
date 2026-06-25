import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("react-router-dom", () => ({
  useParams: () => ({ projectId: "test-project" }),
  useLocation: () => ({ pathname: "/project/test-project/stage1" }),
  useNavigate: () => vi.fn(),
  Outlet: () => null,
}));

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

describe("Stage1Page", () => {
  it("renders title and empty state", () => {
    render(<Stage1Page />);
    expect(screen.getByText("STAGE 1 — 概念讨论")).toBeInTheDocument();
    expect(screen.getByText(/点击.*生成概念.*开始阶段 1/)).toBeInTheDocument();
  });

  it("renders generate button", () => {
    render(<Stage1Page />);
    expect(screen.getByText("生成概念")).toBeInTheDocument();
  });
});

describe("Stage2Page", () => {
  it("renders title and tab switcher", () => {
    render(<Stage2Page />);
    expect(screen.getByText("STAGE 2 — 世界观与角色")).toBeInTheDocument();
    expect(screen.getByText("世界观")).toBeInTheDocument();
    expect(screen.getByText("角色设定")).toBeInTheDocument();
  });

  it("shows world empty state by default", () => {
    render(<Stage2Page />);
    expect(screen.getByText("尚未生成世界观")).toBeInTheDocument();
  });

  it("switches to character tab", () => {
    render(<Stage2Page />);
    act(() => {
      screen.getByRole("button", { name: /角色设定/ }).click();
    });
    expect(screen.getByText("尚未生成角色设定")).toBeInTheDocument();
  });
});

describe("Stage3Page", () => {
  it("renders title and empty state", () => {
    render(<Stage3Page />);
    expect(screen.getByText("STAGE 3 — 情节头脑风暴")).toBeInTheDocument();
    expect(screen.getByText(/点击.*生成大纲.*开始阶段 3/)).toBeInTheDocument();
  });

  it("renders generate button", () => {
    render(<Stage3Page />);
    expect(screen.getByText("生成大纲")).toBeInTheDocument();
  });

  it("renders novel-level outline panel above chapter outline", () => {
    render(<Stage3Page />);
    expect(screen.getByText("全书大纲")).toBeInTheDocument();
    expect(screen.getByText("AI 生成全书大纲")).toBeInTheDocument();
    expect(
      screen.getByText(/尚未生成 — AI 将基于 STAGE2 的世界观和角色设计全书骨架/)
    ).toBeInTheDocument();
  });

  it("shows banner when novel outline is missing", () => {
    render(<Stage3Page />);
    expect(
      screen.getByText(/建议先生成.+全书大纲.+以让后续章节与全本骨架保持一致/)
    ).toBeInTheDocument();
  });
});

describe("Stage4Page", () => {
  it("renders title and idle state", () => {
    render(<Stage4Page />);
    expect(screen.getByText("STAGE 4 — 写作中心")).toBeInTheDocument();
    expect(screen.getByText("点击「开始写作」生成场景草稿")).toBeInTheDocument();
  });

  it("renders controls bar", () => {
    render(<Stage4Page />);
    expect(screen.getByText("章节")).toBeInTheDocument();
    expect(screen.getByText("场景")).toBeInTheDocument();
    expect(screen.getByText("跳过场景")).toBeInTheDocument();
  });

  it("renders start writing button", () => {
    render(<Stage4Page />);
    expect(screen.getByText("开始写作")).toBeInTheDocument();
  });
});
