import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import S0ECommitStep from "@/components/wizard/divergence/S0ECommitStep";
import api from "@/api/client";
import type { CommitResponse, NoveltyScores } from "@/api/client";

vi.mock("@/api/client", () => ({
  default: {
    getDivergeNovelty: vi.fn(),
    postDivergeCommit: vi.fn(),
    postDivergeRegenerateNovelty: vi.fn(),
  },
}));

const novelty: NoveltyScores = {
  market_saturation: 70,
  trope_similarity: 60,
  contradiction_depth: 80,
  discussion_potential: 50,
  composite: 65,
  grade: "中等",
  computed_at: "2026-08-31T00:00:00Z",
  trope_extraction_status: "completed",
};

const commitResp: CommitResponse = {
  concept_preview: { title: "Test Concept" },
  story_dna_preview: { value_stack: [] },
  novelty_summary: novelty,
  next_step_url: "/project/p1/wizard?step=2",
  warnings: [],
  source: "canvas",
  committed_at: "2026-08-31T00:00:00Z",
};

describe("S0ECommitStep", () => {
  beforeEach(() => {
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeCommit as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      novelty,
    );
    (api.postDivergeCommit as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      commitResp,
    );
    (api.postDivergeRegenerateNovelty as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.postDivergeRegenerateNovelty as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...novelty,
      composite: 78,
      grade: "良好",
      regenerated: true,
      user_modifications_received: true,
    });
  });

  it("renders the 4 novelty dimensions after fetch", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/市场饱和度/)).toBeInTheDocument();
      expect(screen.getByText(/套路相似度/)).toBeInTheDocument();
      expect(screen.getByText(/矛盾深度/)).toBeInTheDocument();
      expect(screen.getByText(/讨论潜力/)).toBeInTheDocument();
    });
  });

  // Layout regression: the radar and the 4-axis evaluation used to render
  // as two internal columns inside one shared bordered card. They were
  // then split into two separate display boxes so the user can scan
  // each evidence view independently. The radar must be the center
  // (visual centerpiece) and the evaluation the left peer — DOM order
  // is the contract the visual layout depends on.
  it("renders the radar and evaluation as two peer cards with the radar centered", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("novelty-evaluation-card"));
    const row = screen.getByTestId("novelty-row");
    const evalCard = screen.getByTestId("novelty-evaluation-card");
    const radarCard = screen.getByTestId("novelty-radar-card");
    const radar = screen.getByTestId("novelty-radar");
    const evaluation = screen.getByTestId("novelty-market-saturation");
    // Both cards are direct children of the row.
    expect(evalCard.parentElement).toBe(row);
    expect(radarCard.parentElement).toBe(row);
    // DOM order must be evaluation → radar (left → center), so the
    // radar occupies the middle column and the conclusion card (when
    // shown) sits to its right.
    const children = Array.from(row.children);
    expect(children.indexOf(evalCard)).toBeLessThan(children.indexOf(radarCard));
    expect(row.contains(radar)).toBe(true);
    expect(row.contains(evaluation)).toBe(true);
    // And the row itself must be a horizontal flex layout.
    expect(row.className).toMatch(/\bmd:flex-row\b/);
  });

  it("grows the radar card with flex-1 and enforces a minimum width", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("novelty-radar-card"));
    const radarCard = screen.getByTestId("novelty-radar-card");
    // The radar card uses flex-1 to fill the space between the two
    // fixed-width peer cards (evaluation on the left, conclusion on the
    // right). min-w-[280px] prevents the chart from being squeezed
    // below a readable size when the row is narrow. Asserted via
    // className because jsdom doesn't compute layout.
    expect(radarCard.className).toMatch(/\bflex-1\b/);
    expect(radarCard.className).toMatch(/min-w-\[280px\]/);
  });

  it("shrinks the evaluation card to a compact fixed-width column on the left", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("novelty-evaluation-card"));
    const evalCard = screen.getByTestId("novelty-evaluation-card");
    // md:w-56 (14rem ≈ 224px) keeps the evaluation list compact next
    // to the wider center radar card. flex-shrink-0 prevents the radar
    // from pushing it smaller.
    expect(evalCard.className).toMatch(/\bmd:w-56\b/);
    expect(evalCard.className).toMatch(/\bflex-shrink-0\b/);
  });

  it("enlarges the radar chart to 280px tall so the center column reads as the focal point", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("novelty-radar"));
    const radar = screen.getByTestId("novelty-radar") as HTMLElement;
    // The radar wrapper sets height via inline style (height prop on
    // NoveltyRadar) so the chart circle grows beyond the default 240px.
    // Verify the inline style was applied.
    expect(radar.firstElementChild).not.toBeNull();
    const chartContainer = radar.firstElementChild as HTMLElement;
    expect(chartContainer.style.height).toBe("280px");
  });

  it("labels each card with its own heading so the user can scan them independently", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("novelty-evaluation-card"));
    // Each peer card has its own heading. Otherwise the user can't tell
    // which box is the chart and which is the text evaluation.
    expect(
      screen.getByRole("heading", { name: "新颖度雷达", level: 3 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "新颖度评价", level: 3 }),
    ).toBeInTheDocument();
  });

  // Layout regression: the value stack used to render below the novelty
  // row, which forced the user to scroll past the radar + evaluation +
  // conclusion block to reach the editable section. Moved above so
  // reading order flows: edit values → see verdict side-by-side.
  it("renders the value stack above the novelty row", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("novelty-row"));
    // Locate the value-stack section by its "价值栈" heading.
    const valueStackHeading = screen.getByRole("heading", { name: "价值栈", level: 3 });
    const noveltyRow = screen.getByTestId("novelty-row");
    // The value-stack section (closest bordered container of the
    // heading) must come BEFORE the novelty row in document order.
    // compareDocumentPosition returns a bitmask; bit 4 = FOLLOWING.
    const position = valueStackHeading.compareDocumentPosition(noveltyRow);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the edit-value-stack button (the value-stack section's affordance)
    // must precede the novelty row in DOM order so screen readers and
    // keyboard tab order reach the editable fields first.
    const editButton = screen.getByTestId("edit-value-stack");
    const editPos = editButton.compareDocumentPosition(noveltyRow);
    expect(editPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Layout regression: the low-novelty warning used to render as a
  // separate full-width alert BELOW the bordered card, which pushed it
  // next to the value-stack editor and out of immediate context with the
  // radar it was commenting on. The warning must now be a third peer
  // card sitting on the right side of the radar so the user reads
  // evaluation → radar → conclusion as a left-to-right composed block.
  it("places the low-novelty conclusion card to the right of the radar", async () => {
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...novelty,
      composite: 35,
    });
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("warning-low-novelty"));
    const row = screen.getByTestId("novelty-row");
    const evalCard = screen.getByTestId("novelty-evaluation-card");
    const radarCard = screen.getByTestId("novelty-radar-card");
    const warning = screen.getByTestId("warning-low-novelty");
    // All three peer cards must be direct children of the row.
    expect(evalCard.parentElement).toBe(row);
    expect(radarCard.parentElement).toBe(row);
    expect(warning.parentElement).toBe(row);
    // DOM order: evaluation → radar → conclusion (left to right).
    const children = Array.from(row.children);
    expect(children.indexOf(evalCard)).toBeLessThan(children.indexOf(radarCard));
    expect(children.indexOf(radarCard)).toBeLessThan(children.indexOf(warning));
    // Conclusion must carry its own heading.
    expect(
      screen.getByRole("heading", { name: "评估结论", level: 3 }),
    ).toBeInTheDocument();
  });

  it("shows warning banner when composite < 40 but does not disable submit", async () => {
    (api.getDivergeNovelty as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...novelty,
      composite: 35,
    });
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("warning-low-novelty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("s0e-submit")).not.toBeDisabled();
  });

  it("calls onComplete with response on submit", async () => {
    const onComplete = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("s0e-submit"));
    await waitFor(() => {
      expect(api.postDivergeCommit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ confirmed_path_ids: ["root", "c1"] }),
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ next_step_url: expect.any(String) }),
      );
    });
  });

  it("allows hand-edit of value_stack before commit (4 layers)", async () => {
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("edit-value-stack"));
    const inputs = screen.getAllByTestId(/^vs-input-/);
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId("vs-input-personal")).toBeInTheDocument();
    expect(screen.getByTestId("vs-input-social")).toBeInTheDocument();
    expect(screen.getByTestId("vs-input-philosophical")).toBeInTheDocument();
    expect(screen.getByTestId("vs-input-existential")).toBeInTheDocument();
  });

  it("sends value_stack_override when edited", async () => {
    const onComplete = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("edit-value-stack"));
    fireEvent.change(screen.getByTestId("vs-input-personal"), {
      target: { value: "自由, 束缚" },
    });
    fireEvent.change(screen.getByTestId("vs-input-social"), {
      target: { value: "归属, 孤独" },
    });
    fireEvent.change(screen.getByTestId("vs-input-philosophical"), {
      target: { value: "理性, 信仰" },
    });
    fireEvent.change(screen.getByTestId("vs-input-existential"), {
      target: { value: "存在, 虚无" },
    });
    fireEvent.click(screen.getByTestId("s0e-submit"));
    await waitFor(() => {
      expect(api.postDivergeCommit).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          value_stack_override: expect.arrayContaining([
            expect.objectContaining({
              level: "personal",
              value_a: "自由",
              value_b: "束缚",
            }),
          ]),
        }),
      );
    });
  });

  it("fires onBack when back button clicked", async () => {
    const onBack = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={onBack}
      />,
    );
    await waitFor(() => screen.getByTestId("s0e-submit"));
    fireEvent.click(screen.getByTestId("s0e-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("regen button calls regen API + updates scores", async () => {
    const onCanvasMutated = vi.fn();
    render(
      <S0ECommitStep
        projectId="p1"
        selectedPath={["root", "c1"]}
        onComplete={() => {}}
        onBack={() => {}}
        onCanvasMutated={onCanvasMutated}
      />,
    );
    await waitFor(() => screen.getByText(/综合分/));
    // Baseline composite from `novelty` fixture is 65.
    expect(screen.getByText("65")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("s0e-regenerate"));
    await waitFor(() => {
      expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => {
      expect(api.postDivergeRegenerateNovelty).toHaveBeenCalledWith(
        "p1",
        { user_modifications: "" },
      );
      expect(onCanvasMutated).toHaveBeenCalled();
    });
    // New composite (78) replaces the baseline (65) in the rendered UI.
    await waitFor(() => {
      expect(screen.getByText("78")).toBeInTheDocument();
    });
  });
});