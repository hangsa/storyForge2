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

  it("labels the prompt input as 创作意图", () => {
    renderStep();
    expect(screen.getByText("创作意图")).toBeInTheDocument();
  });

  it("disables generate button until prompt is filled", () => {
    renderStep();
    const gen = screen.getByTestId("cd-generate") as HTMLButtonElement;
    expect(gen.disabled).toBe(true);
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

  // Regression: malformed generate response (e.g., backend returned {detail: "..."}
  // because the proxy unwrapped an error) used to crash the whole settings tab —
  // setVariants(undefined) → variants.length throws on next render. Now we must
  // surface a banner and keep the prompt intact.
  it("generate with malformed response ({}) shows error banner, does not crash", async () => {
    (api.generateCreativeDivergenceVariants as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    renderStep();
    fireEvent.change(screen.getByTestId("cd-prompt"), { target: { value: "AI 与自然的关系" } });
    fireEvent.click(screen.getByTestId("cd-generate"));
    const banner = await screen.findByTestId("cd-error");
    expect(banner).toBeInTheDocument();
    // Prompt must survive the failed generate
    expect((screen.getByTestId("cd-prompt") as HTMLTextAreaElement).value).toBe("AI 与自然的关系");
  });

  it("generate with variants:null shows error banner", async () => {
    (api.generateCreativeDivergenceVariants as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ variants: null });
    renderStep();
    fireEvent.change(screen.getByTestId("cd-prompt"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("cd-generate"));
    expect(await screen.findByTestId("cd-error")).toBeInTheDocument();
  });

  // Regression: handleConfirm accessed r.concept_payload.X directly. A 200
  // response without concept_payload (e.g., backend schema drift, mock
  // returning empty) crashed the entire settings tab.
  it("select with missing concept_payload shows error banner, does not crash or navigate", async () => {
    (api.generateCreativeDivergenceVariants as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      variants: [
        { id: "v1", label: "概念 ALPHA", title: "风暴密码", description: "AI 试图...", tags: ["科幻"], created_at: "2026-08-30T00:00:00Z" },
      ],
    });
    (api.selectCreativeDivergenceVariant as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
    renderStep();
    fireEvent.change(screen.getByTestId("cd-prompt"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("cd-generate"));
    await screen.findByText("风暴密码");
    fireEvent.click(screen.getByTestId("cd-confirm"));
    expect(await screen.findByTestId("cd-error")).toBeInTheDocument();
    // Should still be on step 1 (concept payload didn't arrive)
    expect(screen.getByText("创意发散")).toBeInTheDocument();
  });

  // Regression: variant cards with missing `tags` field used to throw
  // "Cannot read properties of undefined (reading 'length')" on render.
  it("renders a variant with missing tags without crashing", async () => {
    (api.generateCreativeDivergenceVariants as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      variants: [
        { id: "v1", label: "概念 ALPHA", title: "无 tag 变体", description: "desc", created_at: "2026-08-30T00:00:00Z" },
      ],
    });
    renderStep();
    fireEvent.change(screen.getByTestId("cd-prompt"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("cd-generate"));
    expect(await screen.findByText("无 tag 变体")).toBeInTheDocument();
  });
});
