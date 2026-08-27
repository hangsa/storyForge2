import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HomePage from "../pages/HomePage";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("storyforge.home.sidebar.collapsed");
});

describe("HomePage", () => {
  it("renders StatsSidebar and BookShelf table after projects load", async () => {
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/project/list")) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, detail: [] })));
      }
      if (typeof url === "string" && url.includes("/api/project/stats")) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, detail: {} })));
      }
      return Promise.resolve(new Response("{}"));
    });
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByTestId("stats-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("book-shelf")).toBeInTheDocument();
    });
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
  });

  it("shows the bookshelf empty state when there are no projects", async () => {
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/project/list")) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, detail: [] })));
      }
      if (typeof url === "string" && url.includes("/api/project/stats")) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, detail: {} })));
      }
      return Promise.resolve(new Response("{}"));
    });
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
    });
  });
});
