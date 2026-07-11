import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContextPanel from "../components/workspace/ContextPanel";

vi.mock("../api/client", () => ({
  default: {
    getConcept: vi.fn().mockResolvedValue({ concept: { title: "末世之塔", genre: "xianxia", premise: "修真与灭世" }, story_dna: null }),
    getWorld: vi.fn().mockResolvedValue({ era: "修真纪元", era_social_structure: "宗门林立", era_cultural_history: "万年大战" }),
    getCharacter: vi.fn().mockResolvedValue({ characters: [{ name: "林峰" }, { name: "苏晓晓" }, { name: "师父" }] }),
    getOutline: vi.fn().mockResolvedValue({ chapters: [{ title: "第一章 开场" }, { title: "第二章 发现" }, { title: "第三章 冲突" }, { title: "第四章 高潮" }] }),
  },
}));

function setupActivePanel(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<ContextPanel projectId="p1" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ContextPanel", () => {
  it.each([
    "concept", "world", "character", "outline", "diagnosis", "export",
  ])("renders %s tab active when ?panel=%s", async (panel) => {
    setupActivePanel(`/workspace?mode=manual&panel=${panel}`);
    expect(await screen.findByTestId(`context-tab-${panel}-active`)).toBeInTheDocument();
  });

  it("defaults to concept when ?panel= is missing or garbage", async () => {
    setupActivePanel(`/workspace?mode=manual`);
    expect(await screen.findByTestId("context-tab-concept-active")).toBeInTheDocument();
  });

  it("concept tab preview shows fetched concept fields", async () => {
    setupActivePanel("/workspace?mode=manual&panel=concept");
    await waitFor(() =>
      expect(screen.getByTestId("context-preview-concept")).toHaveTextContent(/末世之塔.*修真与灭世|修真纪元/),
    );
  });

  it("character tab preview lists first 5 character names", async () => {
    setupActivePanel("/workspace?mode=manual&panel=character");
    await waitFor(() =>
      expect(screen.getByTestId("context-preview-character")).toHaveTextContent("林峰"),
    );
    expect(screen.getByTestId("context-preview-character").textContent).toContain("苏晓晓");
    expect(screen.getByTestId("context-preview-character").textContent).toContain("师父");
  });

  it("every tab exposes a link to the relevant full Stage page", async () => {
    setupActivePanel("/workspace?mode=manual&panel=concept");
    expect(screen.getByTestId("context-link-concept").getAttribute("href"))
      .toBe("/project/p1/stage1");

    setupActivePanel("/workspace?mode=manual&panel=diagnosis");
    expect(screen.getByTestId("context-link-diagnosis").getAttribute("href"))
      .toBe("/project/p1/stage5");
  });
});