import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import S1InputStep from "@/components/wizard/divergence_v2/S1InputStep";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postThreeBDiverge: vi.fn(),
    postThreeBDeepen: vi.fn(),
    postThreeBCommit: vi.fn(),
    postThreeBRegenerateCandidate: vi.fn(),
    getThreeBState: vi.fn(),
    deleteThreeBState: vi.fn(),
  },
}));

describe("S1InputStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form fields", () => {
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={() => {}}
      />,
    );
    expect(screen.getByLabelText(/灵感点子/i)).toBeTruthy();
    expect(screen.getByLabelText(/主类型/i)).toBeTruthy();
  });

  it("disables submit when prompt <10 chars", () => {
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "短" },
    });
    const btn = screen.getByRole("button", { name: /开始 3B 发散/i });
    expect(btn).toBeDisabled();
  });

  it("calls api.postThreeBDiverge on submit", async () => {
    (api.postThreeBDiverge as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ candidates: [], by_operator: {} });
    const onSubmitted = vi.fn();
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={onSubmitted}
      />,
    );
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始 3B 发散/i }));
    await waitFor(() => {
      expect(api.postThreeBDiverge).toHaveBeenCalledWith("p1", {
        prompt: "足够长的原始灵感点子",
        genre_primary: "玄幻",
        genre_secondary: null,
      });
    });
    expect(onSubmitted).toHaveBeenCalled();
  });
});
