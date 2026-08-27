import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HomePage from "../pages/HomePage";

vi.mock("../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("storyforge.home.sidebar.collapsed");
});

function mockEmptyProjectEndpoints() {
  vi.spyOn(global, "fetch").mockImplementation((url) => {
    if (typeof url === "string" && url.includes("/api/project/list")) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, detail: [] })));
    }
    if (typeof url === "string" && url.includes("/api/project/stats")) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, detail: {} })));
    }
    return Promise.resolve(new Response("{}"));
  });
}

describe("HomePage", () => {
  it("renders StatsSidebar, CreateProjectCard, and BookShelf table after projects load", async () => {
    mockEmptyProjectEndpoints();
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByTestId("stats-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("book-shelf")).toBeInTheDocument();
    });
    // CreateProjectCard must render so users can create a project from the
    // new HomePage. Regressing this (e.g. by removing the card import or
    // dropping the render) would re-introduce the bug where "+ 新建项目"
    // silently did nothing.
    expect(screen.getByTestId("create-project-card")).toBeInTheDocument();
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
  });

  it("shows the bookshelf empty state when there are no projects", async () => {
    mockEmptyProjectEndpoints();
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
    });
  });
});
