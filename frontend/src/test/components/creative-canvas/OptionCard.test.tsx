import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OptionCard } from "@/components/creative-canvas/OptionCard";
import type { CreativeOption } from "@/api/client";

const baseOption: CreativeOption = {
  id: "opt_3_a",
  title: "克苏鲁神话",
  premise: "飞升并非进入仙界...",
  logic: "",
  scores: {},
};

describe("OptionCard", () => {
  it("renders operation label + slot + theme_name as title", () => {
    render(
      <OptionCard
        option={baseOption}
        slot="A"
        operationLabel="融合"
        recommended={false}
        selected={false}
        onSelect={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByText(/融合 A: 克苏鲁神话/)).toBeInTheDocument();
  });

  it("shows AI Recommended badge when recommended=true", () => {
    render(
      <OptionCard
        option={{ ...baseOption, id: "opt_3_b", title: "赛博朋克" }}
        slot="B"
        operationLabel="融合"
        recommended={true}
        selected={false}
        onSelect={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByText(/AI Recommended/i)).toBeInTheDocument();
  });

  it("renders 2-stat score display (Novelty + Conflict only)", () => {
    render(
      <OptionCard
        option={{ ...baseOption, scores: { novelty: 0.9, conflict: 0.85 } }}
        slot="A"
        operationLabel="融合"
        recommended={false}
        selected={false}
        onSelect={() => {}}
        disabled={false}
      />,
    );
    expect(screen.getByText(/Novelty/)).toBeInTheDocument();
    expect(screen.getByText(/Conflict/)).toBeInTheDocument();
    // 故事潜力 NOT shown (dropped from design)
    expect(screen.queryByText(/故事潜力/)).not.toBeInTheDocument();
  });

  it('button copy is "Continue with Option X" when recommended, else "Select Option X"', () => {
    const { rerender } = render(
      <OptionCard
        option={baseOption}
        slot="A"
        operationLabel="融合"
        recommended={false}
        selected={false}
        onSelect={() => {}}
        disabled={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Select Option A/ }),
    ).toBeInTheDocument();

    rerender(
      <OptionCard
        option={{ ...baseOption, id: "opt_3_b" }}
        slot="B"
        operationLabel="融合"
        recommended={true}
        selected={false}
        onSelect={() => {}}
        disabled={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Continue with Option B/ }),
    ).toBeInTheDocument();
  });

  it("calls onSelect with option id when clicked", () => {
    const onSelect = vi.fn();
    render(
      <OptionCard
        option={baseOption}
        slot="A"
        operationLabel="融合"
        recommended={false}
        selected={false}
        onSelect={onSelect}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Select Option A/ }));
    expect(onSelect).toHaveBeenCalledWith("opt_3_a");
  });
});