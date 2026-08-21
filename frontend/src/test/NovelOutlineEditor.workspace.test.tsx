import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../api/client", () => ({
  default: {
    regenerateNovelOutlineSection: vi.fn(),
    updateNovelOutline: vi.fn(),
  },
}));

import api from "../api/client";
import { ToastProvider, useToast } from "../hooks/useToast";
import NovelOutlineEditor from "../components/workspace/editors/NovelOutlineEditor";

const SEED = {
  core_conflict_theme: "原核心冲突",
  volumes: [
    { name: "第一卷", chapter_range: "1-5", summary: "原概要", key_events: ["原事件"] },
  ],
  mc_growth_arc: [
    { label: "原阶段", target_chapter_range: "1-5", description: "原弧线" },
  ],
  key_plot_points: [
    {
      title: "原关键点",
      must_appear_in_volume: "第一卷",
      trigger_chapter_hint: "3",
      description: "原描述",
    },
  ],
  generated_at: "",
  updated_at: "",
};

// ToastRecorder pattern (same as WorldEditor.workspace.test.tsx) so we read the
// same context the production code uses — avoids brittle hook mocks.
function ToastRecorder({ onShow }: { onShow: (messages: string[]) => void }) {
  const { toasts } = useToast();
  onShow(toasts.map((t) => t.message));
  return <div data-testid="toast-snapshot">{toasts.length}</div>;
}

function renderWithToast(
  node: React.ReactElement,
  onShow: (messages: string[]) => void = () => {},
) {
  return render(
    <ToastProvider>
      <ToastRecorder onShow={onShow} />
      {node}
    </ToastProvider>,
  );
}

beforeEach(() => {
  (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockReset();
  (api.updateNovelOutline as ReturnType<typeof vi.fn>).mockReset();
});

describe("NovelOutlineEditor regenerate", () => {
  it("renders 4 section regenerate buttons", () => {
    renderWithToast(<NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} />);
    expect(screen.getByTestId("section-regenerate-core_conflict")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-volumes")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-mc_growth")).toBeInTheDocument();
    expect(screen.getByTestId("section-regenerate-key_plot")).toBeInTheDocument();
  });

  it("clicking core_conflict calls API and merges result into local state", async () => {
    (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SEED,
      core_conflict_theme: "新核心冲突",
    });
    renderWithToast(<NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} />);

    fireEvent.click(screen.getByTestId("section-regenerate-core_conflict"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateNovelOutlineSection).toHaveBeenCalledWith("p1", "core_conflict", ""),
    );
    await waitFor(() =>
      expect((screen.getByTestId("novel-outline-theme") as HTMLTextAreaElement).value).toBe(
        "新核心冲突",
      ),
    );
  });

  it("clicking volumes calls API with section=volumes and merges volumes", async () => {
    (api.regenerateNovelOutlineSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...SEED,
      volumes: [{ name: "新卷", chapter_range: "1-9", summary: "新概要", key_events: [] }],
    });
    renderWithToast(<NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} />);

    fireEvent.click(screen.getByTestId("section-regenerate-volumes"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(api.regenerateNovelOutlineSection).toHaveBeenCalledWith("p1", "volumes", ""),
    );
    await waitFor(() =>
      expect((screen.getByTestId("novel-outline-volume-0-name") as HTMLInputElement).value).toBe(
        "新卷",
      ),
    );
  });

  it("readOnly=true hides all regenerate buttons", () => {
    renderWithToast(
      <NovelOutlineEditor projectId="p1" data={SEED} onSaved={() => {}} readOnly />,
    );
    expect(screen.queryByTestId("section-regenerate-core_conflict")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-volumes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-mc_growth")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-regenerate-key_plot")).not.toBeInTheDocument();
  });
});
