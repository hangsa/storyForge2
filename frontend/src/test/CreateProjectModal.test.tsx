import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("renders the title-required marker and disabled submit when title empty", () => {
    render(
      <CreateProjectModal
        isOpen
        submitting={false}
        error={null}
        onSubmit={async () => {}}
        onClose={() => {}}
      />
    );
    const labels = screen.getAllByText("项目名称");
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels[0].parentElement?.textContent).toContain("*");
    const submit = screen.getByTestId("create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("enables submit and calls onSubmit with title when filled", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <CreateProjectModal
        isOpen
        submitting={false}
        error={null}
        onSubmit={onSubmit}
        onClose={() => {}}
      />
    );
    await user.type(screen.getByTestId("title-input"), "我的新项目");
    const submit = screen.getByTestId("create-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: "我的新项目" })
    );
  });
});
