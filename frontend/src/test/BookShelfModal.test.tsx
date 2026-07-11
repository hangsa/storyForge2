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
  it("links STAGE4+ projects to /workspace?mode=managed (not the old /stage1)", () => {
    renderModal([
      { id: "proj_post", title: "已完成", genre: "cool_novel", current_stage: "STAGE4", created_at: "2026-07-10T00:00:00", min_words: 4000, target_total_words: 4000, target_length_category: "" },
    ]);
    const link = screen.getByRole("link", { name: /已完成/ });
    expect(link.getAttribute("href")).toBe("/project/proj_post/workspace?mode=managed");
  });

  it("links INIT/STAGE1-3 projects to /wizard so users can resume initialization", () => {
    renderModal([
      { id: "proj_pre", title: "未完成", genre: "cool_novel", current_stage: "STAGE2", created_at: "2026-07-09T00:00:00", min_words: 4000, target_total_words: 4000, target_length_category: "" },
    ]);
    const link = screen.getByRole("link", { name: /未完成/ });
    expect(link.getAttribute("href")).toBe("/project/proj_pre/wizard");
  });
});