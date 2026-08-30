import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CreativeDivergenceStep from "./CreativeDivergenceStep";
import api from "../../api/client";
import { WizardProvider } from "./WizardContext";

vi.mock("../../api/client", () => ({
  default: {
    listCreativeDivergenceVariants: vi.fn().mockResolvedValue({ variants: [], selected_id: null }),
    generateCreativeDivergenceVariants: vi.fn().mockResolvedValue({
      variants: [
        { id: "v1", label: "概念 ALPHA", title: "风暴密码", description: "AI 试图...", tags: ["科幻", "悬疑"], created_at: "2026-08-30T00:00:00Z" },
        { id: "v2", label: "概念 BETA", title: "大气回响", description: "AI 已经...", tags: ["心理"], created_at: "2026-08-30T00:00:01Z" },
      ],
    }),
    selectCreativeDivergenceVariant: vi.fn().mockResolvedValue({
      concept_payload: { title: "风暴密码", genre: "科幻", premise: "AI 试图...", tone: "惊悚", theme: "人与自然", source: "creative_divergence", source_variant_id: "v1" },
    }),
  },
}));

function renderStep() {
  return render(
    <WizardProvider projectId="proj_test">
      <CreativeDivergenceStep projectId="proj_test" />
    </WizardProvider>
  );
}

describe("CreativeDivergenceStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders header + glass-panel input + generate button", () => {
    renderStep();
    expect(screen.getByText("创意发散")).toBeInTheDocument();
    expect(screen.getByText("生成概念")).toBeInTheDocument();
  });

  it("renders placeholder when no variants exist", async () => {
    renderStep();
    await waitFor(() => expect(api.listCreativeDivergenceVariants).toHaveBeenCalled());
    expect(screen.getByText(/点生成开始创意发散|暂无变体/i)).toBeInTheDocument();
  });

  it("clicking generate renders 4 variant cards", async () => {
    renderStep();
    fireEvent.change(screen.getByTestId("cd-prompt"), { target: { value: "AI 与自然的关系" } });
    fireEvent.click(screen.getByText("生成概念"));
    await waitFor(() => expect(screen.getByText("风暴密码")).toBeInTheDocument());
    expect(screen.getByText("大气回响")).toBeInTheDocument();
  });
});