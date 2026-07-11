import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContextPanel from "../components/workspace/ContextPanel";

vi.mock("../../api/client", () => ({
  default: {
    getConcept: vi.fn().mockResolvedValue({ concept: null, story_dna: null }),
    getWorld: vi.fn().mockResolvedValue({}),
    getCharacter: vi.fn().mockResolvedValue({ characters: [] }),
    getNovelOutline: vi.fn().mockResolvedValue({}),
    getOutline: vi.fn().mockResolvedValue({ chapters: [] }),
  },
}));

function setupActivePanel(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<ContextPanel projectId="p" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ContextPanel", () => {
  it.each([
    ["concept", "concept"],
    ["world", "world"],
    ["character", "character"],
    ["outline", "outline"],
    ["diagnosis", "diagnosis"],
    ["export", "export"],
  ])("renders %s tab when ?panel=%s", async (_label, panel) => {
    setupActivePanel(`/workspace?mode=manual&panel=${panel}`);
    expect(await screen.findByTestId(`context-tab-${panel}-active`)).toBeInTheDocument();
  });

  it("defaults to concept when ?panel= is missing or garbage", async () => {
    setupActivePanel(`/workspace?mode=manual`);
    expect(await screen.findByTestId("context-tab-concept-active")).toBeInTheDocument();
  });
});
