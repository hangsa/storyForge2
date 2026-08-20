import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChapterOutlineEditor from "../components/workspace/editors/ChapterOutlineEditor";

vi.mock("../api/client", () => ({
  default: {
    getOutline: vi.fn(),
    updateOutline: vi.fn(),
  },
}));

import api from "../api/client";
const mockedUpdateOutline = api.updateOutline as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedUpdateOutline.mockReset().mockResolvedValue(undefined);
});

describe("ChapterOutlineEditor", () => {
  it("renders the loading state initially", async () => {
    // The editor reads `data` synchronously on mount; if we pass `undefined`,
    // it shows a loading placeholder until the parent (ContextPanel) passes
    // real data.
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={undefined}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-loading")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-outline-loading")).toHaveTextContent("加载中");
  });

  it("renders the empty state when chapters are empty", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{ chapters: [] }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-editor")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-outline-empty")).toHaveTextContent("尚未生成");
  });
});
