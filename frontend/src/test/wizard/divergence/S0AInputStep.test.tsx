import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0AInputStep from "@/components/wizard/divergence/S0AInputStep";
import api from "@/api/client";

vi.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    postDivergeInit: vi.fn().mockResolvedValue({ detail: {} }),
    postDivergeRegenerateRawIntent: vi.fn(),
    postDivergeFuse: vi.fn().mockResolvedValue({
      variants: [
        {
          id: "var-fuse-1",
          title: "fusion",
          premise_one_line: "f",
          mutation_type: "fusion",
          mutation_logic: "",
          estimated_novelty: 0.7,
          trope_tags: ["xianxia", "xuanyi"],
          regenerated_count: 0,
          risk_level: "medium",
          fusion_distance: 2,
        },
      ],
      fusion_distance: { distance: 2, compatibility: "中" },
      risk_level: "medium",
    }),
  },
}));

describe("S0AInputStep", () => {
  beforeEach(() => {
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      { detail: {} },
    );
    (api.postDivergeFuse as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeFuse as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      variants: [
        {
          id: "var-fuse-1",
          title: "fusion",
          premise_one_line: "f",
          mutation_type: "fusion",
          mutation_logic: "",
          estimated_novelty: 0.7,
          trope_tags: ["xianxia", "xuanyi"],
          regenerated_count: 0,
          risk_level: "medium",
          fusion_distance: 2,
        },
      ],
      fusion_distance: { distance: 2, compatibility: "中" },
      risk_level: "medium",
    });
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
        expect.objectContaining({
          prompt: "一个完整的故事想法,够长够详细",
          genre_primary: "修仙",
        }),
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "一个完整的故事想法,够长够详细",
          genre_primary: "修仙",
        }),
        null,
        null,
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

  it("does not show enable-fusion checkbox when 副类型 empty", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    expect(screen.queryByTestId("enable-fusion")).toBeNull();
  });

  it("shows enable-fusion checkbox when 副类型 filled", () => {
    render(<S0AInputStep projectId="p1" onComplete={() => {}} />);
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    expect(screen.getByTestId("enable-fusion")).toBeInTheDocument();
  });
});

describe("S0AInputStep fusion trigger", () => {
  beforeEach(() => {
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeInit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      { detail: {} },
    );
    (api.postDivergeFuse as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeFuse as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      variants: [
        {
          id: "var-fuse-1",
          title: "fusion",
          premise_one_line: "f",
          mutation_type: "fusion",
          mutation_logic: "",
          estimated_novelty: 0.7,
          trope_tags: ["xianxia", "xuanyi"],
          regenerated_count: 0,
          risk_level: "medium",
          fusion_distance: 2,
        },
      ],
      fusion_distance: { distance: 2, compatibility: "中" },
      risk_level: "medium",
    });
  });

  it("calls postDivergeFuse when 副类型 filled + 启用类型融合 checked", async () => {
    const onComplete = vi.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "长生者寻死故事的灵感长描述,够长" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));

    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(api.postDivergeInit).toHaveBeenCalledWith(
        "proj_x",
        expect.objectContaining({
          prompt: "长生者寻死故事的灵感长描述,够长",
          genre_primary: "修仙",
          genre_secondary: "悬疑",
        }),
      );
      expect(api.postDivergeFuse).toHaveBeenCalledWith(
        "proj_x",
        expect.objectContaining({
          genre_primary: "修仙",
          genre_secondary: "悬疑",
        }),
      );
    });
  });

  it("does NOT call postDivergeFuse when 启用类型融合 unchecked", async () => {
    const onComplete = vi.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "长生者寻死故事的灵感长描述,够长" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    // NOT clicking enable-fusion

    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(api.postDivergeInit).toHaveBeenCalled();
      expect(api.postDivergeFuse).not.toHaveBeenCalled();
    });
  });

  it("passes fusion variant + null banner to onComplete on success", async () => {
    const onComplete = vi.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "长生者寻死故事的灵感长描述,够长" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ genre_primary: "修仙" }),
        expect.objectContaining({ mutation_type: "fusion" }),
        null,
      );
    });
  });

  it("passes fusion banner when /fuse fails", async () => {
    (api.postDivergeFuse as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("LLM 不可用"),
    );
    const onComplete = vi.fn();
    render(
      <S0AInputStep
        projectId="proj_x"
        onComplete={onComplete}
        initial={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/用一句话/), {
      target: { value: "长生者寻死故事的灵感长描述,够长" },
    });
    fireEvent.change(screen.getByTestId("genre-primary"), {
      target: { value: "修仙" },
    });
    fireEvent.change(screen.getByTestId("genre-secondary"), {
      target: { value: "悬疑" },
    });
    fireEvent.click(screen.getByTestId("enable-fusion"));
    fireEvent.click(screen.getByTestId("s0a-submit"));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(
        expect.anything(),
        null,
        expect.stringContaining("类型融合未启用"),
      );
    });
  });
});