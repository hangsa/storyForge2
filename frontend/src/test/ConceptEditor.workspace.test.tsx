import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    updateConcept: vi.fn(),
    regenerateConceptSection: vi.fn(),
  },
}));

import api from "../api/client";
import { ToastProvider, useToast } from "../hooks/useToast";
import ConceptEditor from "../components/workspace/editors/ConceptEditor";

const SEED = {
  concept: {
    title: "原标题",
    genre: "cool_novel",
    premise: "原前提",
    tone: "",
    theme: "",
    target_audience: "",
    style_template: "",
  },
  story_dna: {
    core_contradiction: { statement: "原矛盾", side_a: "", side_b: "" },
    value_stack: [],
  },
};

// ToastRecorder lives next to the editor so we can read the same context the
// production code uses. Calls are captured in local state and surfaced through
// a testid so we don't have to mock the hook.
function ToastRecorder({ onShow }: { onShow: (messages: string[]) => void }) {
  const { toasts } = useToast();
  onShow(toasts.map((t) => t.message));
  return <div data-testid="toast-snapshot">{toasts.length}</div>;
}

function renderWithToast(
  node: React.ReactElement,
  onShow: (messages: string[]) => void,
) {
  return render(
    <ToastProvider>
      <ToastRecorder onShow={onShow} />
      {node}
    </ToastProvider>,
  );
}

beforeEach(() => {
  (api.updateConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockReset();
});

describe("ConceptEditor regenerate", () => {
  it("renders 2 section regenerate buttons (concept + dna)", () => {
    renderWithToast(<ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} />, () => {});
    expect(screen.getByTestId("section-regenerate-概念")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-Story DNA")).toBeInTheDocument();
  });

  it("clicking concept regenerate calls API and updates local state", async () => {
    (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: { ...SEED.concept, title: "新标题", premise: "新前提" },
      story_dna: SEED.story_dna,
    });
    const messages: string[] = [];
    // Capture by reference so the recorder sees updates.
    const ref = { list: messages };
    renderWithToast(<ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} />, (m) => {
      ref.list = m;
    });

    fireEvent.click(screen.getByTestId("section-regenerate-概念"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateConceptSection).toHaveBeenCalledWith("p1", "concept", ""),
    );
    await waitFor(() =>
      expect((screen.getByTestId("concept-title") as HTMLInputElement).value).toBe("新标题"),
    );
    await waitFor(() => expect(ref.list.some((m) => m.includes("概念"))).toBe(true));
  });

  it("clicking dna regenerate calls API with section=dna and updates local state", async () => {
    (api.regenerateConceptSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      concept: SEED.concept,
      story_dna: {
        core_contradiction: { statement: "新矛盾", side_a: "A", side_b: "B" },
        value_stack: [],
      },
    });
    const ref = { list: [] as string[] };
    renderWithToast(<ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} />, (m) => {
      ref.list = m;
    });

    fireEvent.click(screen.getByTestId("section-regenerate-Story DNA"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateConceptSection).toHaveBeenCalledWith("p1", "dna", ""),
    );
    await waitFor(() =>
      expect((screen.getByTestId("concept-statement") as HTMLTextAreaElement).value).toBe("新矛盾"),
    );
    await waitFor(() => expect(ref.list.some((m) => m.includes("Story DNA"))).toBe(true));
  });

  it("readOnly=true hides both regenerate buttons", () => {
    renderWithToast(<ConceptEditor projectId="p1" data={SEED} onSaved={() => {}} readOnly />, () => {});
    expect(screen.queryByTestId("section-regenerate-概念")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-Story DNA")).not.toBeInTheDocument();
  });
});