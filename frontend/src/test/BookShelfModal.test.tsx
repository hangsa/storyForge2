import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BookShelfModal from "../components/home/BookShelfModal";

function renderModal(projects: Parameters<typeof BookShelfModal>[0]["projects"]) {
  return render(
    <MemoryRouter>
      <BookShelfModal projects={projects} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe("BookShelfModal navigation", () => {
  // v1.9: workspace defaults to manual mode, so the entry URL no longer
  // forces ?mode=managed — the user opts into managed via the top-bar switcher.
  it("links STAGE4 projects to /workspace (default manual mode)", () => {
    renderModal([
      { id: "proj_post", title: "已完成", genre: "cool_novel", current_stage: "STAGE4", created_at: "2026-07-10T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "" },
    ]);
    const link = screen.getByRole("link", { name: /已完成/ });
    expect(link.getAttribute("href")).toBe("/project/proj_post/workspace");
  });

  it("links INIT/STAGE1-3 projects to /wizard so users can resume initialization", () => {
    renderModal([
      { id: "proj_pre", title: "未完成", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-07-09T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "" },
    ]);
    const link = screen.getByRole("link", { name: /未完成/ });
    expect(link.getAttribute("href")).toBe("/project/proj_pre/wizard");
  });

  it("links STAGE5 (diagnosis) projects to /stage5 instead of the workspace", () => {
    renderModal([
      { id: "diag", title: "诊断项目", genre: "cool_novel", current_stage: "STAGE5", created_at: "2026-07-12T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "" },
    ]);
    const link = screen.getByRole("link", { name: /诊断项目/ });
    expect(link.getAttribute("href")).toBe("/project/diag/stage5");
  });

  it("links STAGE6 (export) projects to /stage6 instead of the workspace", () => {
    renderModal([
      { id: "export", title: "导出项目", genre: "cool_novel", current_stage: "STAGE6", created_at: "2026-07-12T00:00:00", updated_at: 0, min_words: 4000, target_total_words: 4000, target_length_category: "" },
    ]);
    const link = screen.getByRole("link", { name: /导出项目/ });
    expect(link.getAttribute("href")).toBe("/project/export/stage6");
  });
});