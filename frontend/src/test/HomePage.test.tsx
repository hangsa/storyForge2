import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HomePage from "../pages/HomePage";
import { ToastProvider } from "../hooks/useToast";

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
      return Promise.resolve(new Response(JSON.stringify({ error: false, detail: {
        total_books: 0, total_chapters: 0, total_words: 0,
        stage_distribution: {}, word_count_series: [],
      } })));
    }
    return Promise.resolve(new Response("{}"));
  });
}

// HomePage now calls useToast for the placeholder 设置/支持 footer handlers,
// so it must render inside a ToastProvider like the real App shell does.
function renderHome() {
  return render(
    <ToastProvider>
      <HomePage />
    </ToastProvider>
  );
}

describe("HomePage", () => {
  it("renders TopBar + StatsSidebar + BookShelf after projects load", async () => {
    mockEmptyProjectEndpoints();
    renderHome();
    await waitFor(() => {
      expect(screen.getByTestId("home-top-bar")).toBeInTheDocument();
      expect(screen.getByTestId("stats-sidebar")).toBeInTheDocument();
      expect(screen.getByTestId("book-shelf")).toBeInTheDocument();
    });
    // Brand + version chip live in the global top bar.
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
    expect(screen.getByTestId("version-chip")).toHaveTextContent("V0.1.0");
    // The card is gone — creation now flows through a modal opened by the
    // BookShelf header's "+ 新建项目" button.
    expect(screen.queryByTestId("create-project-card")).not.toBeInTheDocument();
    expect(screen.getByText("+ 新建项目")).toBeInTheDocument();
  });

  it("opens the create-project modal when the + 新建项目 button is clicked", async () => {
    mockEmptyProjectEndpoints();
    renderHome();
    await waitFor(() => screen.getByText("+ 新建项目"));
    expect(screen.queryByTestId("create-project-modal")).not.toBeInTheDocument();
    const button = screen.getByText("+ 新建项目");
    button.click();
    await waitFor(() => {
      expect(screen.getByTestId("create-project-modal")).toBeInTheDocument();
    });
  });

  it("shows the bookshelf empty state when there are no projects", async () => {
    mockEmptyProjectEndpoints();
    renderHome();
    await waitFor(() => {
      expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
    });
  });
});
