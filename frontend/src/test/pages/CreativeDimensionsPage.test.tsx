import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Routes, Route, MemoryRouter } from "react-router-dom";

vi.mock("@/api/client", () => ({
  default: {
    listAllCreativeDimensions: vi.fn(),
    addCreativeDimension: vi.fn(),
    updateCreativeDimension: vi.fn(),
    deleteCreativeDimension: vi.fn(),
  },
}));
import api from "@/api/client";
import CreativeDimensionsPage from "@/pages/CreativeDimensionsPage";

const stubAll = {
  subject: [
    { id: "xuanhuan", name: "玄幻", description: "东方仙侠世界", status: "active" as const,
      family: "xuanhuan", label_en: "Xuanhuan", order: 0,
      created_at: "x", updated_at: "x" },
  ],
  tone: [
    { id: "rexue", name: "热血", description: "", status: "inactive" as const,
      order: 0, created_at: "x", updated_at: "x" },
  ],
  style: [],
};

describe("CreativeDimensionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listAllCreativeDimensions as any).mockResolvedValue(stubAll);
  });

  it("renders three tabs with badges", async () => {
    render(
      <MemoryRouter initialEntries={["/creative-dimensions"]}>
        <Routes>
          <Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("题材")).toBeInTheDocument());
    expect(screen.getByText("基调")).toBeInTheDocument();
    expect(screen.getByText("风格")).toBeInTheDocument();
  });

  it("lists entries for active kind", async () => {
    render(
      <MemoryRouter initialEntries={["/creative-dimensions"]}>
        <Routes>
          <Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    expect(screen.getByText(/1\/1/)).toBeInTheDocument();
  });

  it("switches tab to tone and lists tone entries", async () => {
    render(
      <MemoryRouter initialEntries={["/creative-dimensions"]}>
        <Routes>
          <Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    screen.getByText("基调").click();
    await waitFor(() => expect(screen.getByText("热血")).toBeInTheDocument());
  });
});
