import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));

import CreateProjectModal from "../components/home/CreateProjectModal";

describe("CreateProjectModal", () => {
  it("renders genre options from useGenres hook", () => {
    render(
      <CreateProjectModal
        isOpen
        submitting={false}
        error={null}
        onSubmit={async () => {}}
        onClose={() => {}}
      />
    );
    const select = screen.getByTestId("genre-input") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("cool_novel");
    expect(options).toContain("xuanyi");
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <CreateProjectModal
        isOpen={false}
        submitting={false}
        error={null}
        onSubmit={async () => {}}
        onClose={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});