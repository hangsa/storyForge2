import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));

import CreateProjectCard from "../components/home/CreateProjectCard";

describe("CreateProjectCard", () => {
  it("renders genre options from useGenres hook", () => {
    render(<CreateProjectCard onSubmit={async () => {}} submitting={false} error={null} />);
    const select = screen.getByTestId("genre-input") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("cool_novel");
    expect(options).toContain("xuanyi");
  });
});