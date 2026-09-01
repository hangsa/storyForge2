import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0AInputStep from "@/components/wizard/divergence/S0AInputStep";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    postDivergeInit: vi.fn(),
    postDivergeRegenerateRawIntent: vi.fn(),
  },
}));

describe("S0AInputStep", () => {
  beforeEach(() => {
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      { premise: "test" },
    );
    (api.postDivergeRegenerateRawIntent as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeRegenerateRawIntent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      { variants: [], user_modifications_received: true },
    );
  });

  it("renders prompt textarea + genre select", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    expect(
      screen.getByPlaceholderText(/用一句话描述你的故事想法/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("genre-primary")).toBeInTheDocument();
    expect(screen.getByTestId("genre-secondary")).toBeInTheDocument();
  });

  it("disables submit when prompt < 10 chars", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText(/用一句话描述/),
      { target: { value: "短" } },
    );
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    expect(screen.getByTestId("s0a-submit")).toBeDisabled();
  });

  it("disables submit when no genre selected", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText(/用一句话描述/),
      { target: { value: "一个完整的故事想法,够长够详细" } },
    );
    expect(screen.getByTestId("s0a-submit")).toBeDisabled();
  });

  it("calls onComplete with raw_intent on valid submit", async () => {
    const onComplete = vi.fn();
    render(<S0AInputStep projectId="p1" onComplete={onComplete} />);
    fireEvent.change(
      screen.getByPlaceholderText(/用一句话描述/),
      { target: { value: "一个完整的故事想法,够长够详细" } },
    );
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.click(screen.getByTestId("s0a-submit"));
    await waitFor(() => {
      expect(api.postDivergeInit).toHaveBeenCalledWith(
        "p1",
        "一个完整的故事想法,够长够详细",
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "一个完整的故事想法,够长够详细",
          genre_primary: "修仙",
        }),
      );
    });
  });

  it("shows error when api rejects", async () => {
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("网络错误"),
    );
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    fireEvent.change(
      screen.getByPlaceholderText(/用一句话描述/),
      { target: { value: "一个完整的故事想法,够长够详细" } },
    );
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.click(screen.getByTestId("s0a-submit"));
    await waitFor(() => {
      expect(screen.getByText("网络错误")).toBeInTheDocument();
    });
  });

  it("disables regen button when no initial raw_intent", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    expect(screen.getByTestId("s0a-regenerate")).toBeDisabled();
  });

  it("regen button opens modal and calls API on confirm", async () => {
    const onCanvasMutated = vi.fn();
    render(
      <S0AInputStep
        projectId="p1"
        initial={{ prompt: "现有故事", genre_primary: "修仙" }}
        onComplete={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    fireEvent.click(screen.getByTestId("s0a-regenerate"));
    await waitFor(() => {
      expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "换成更悬疑的方向" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() => {
      expect(api.postDivergeRegenerateRawIntent).toHaveBeenCalledWith(
        "p1",
        { user_modifications: "换成更悬疑的方向" },
      );
      expect(onCanvasMutated).toHaveBeenCalled();
    });
  });
});