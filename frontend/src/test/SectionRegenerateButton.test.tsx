import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SectionRegenerateButton } from "../components/shared/SectionRegenerateButton";

describe("SectionRegenerateButton", () => {
  it("renders an icon button with the section's test id", () => {
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => {}}
        testId="world-power-system-regenerate"
      />,
    );
    const btn = screen.getByTestId("world-power-system-regenerate");
    expect(btn).toBeInTheDocument();
  });

  it("opens the RegenerateModal when clicked", () => {
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => {}}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    // Modal title includes the target.
    expect(screen.getByText(/重新生成 — 力量体系/)).toBeInTheDocument();
  });

  it("calls onRegenerate with the typed text on confirm", async () => {
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={onRegenerate}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "更紧凑" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith("更紧凑"));
  });

  it("closes the modal on cancel without calling onRegenerate", () => {
    const onRegenerate = vi.fn();
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={onRegenerate}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-cancel"));
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("regenerate-modal")).not.toBeInTheDocument();
  });

  it("disables the button while onRegenerate is in flight", async () => {
    let resolveFn!: () => void;
    const onRegenerate = vi.fn(
      () => new Promise<void>((r) => { resolveFn = r; }),
    );
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={onRegenerate}
        testId="world-power-system-regenerate"
      />,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("world-power-system-regenerate")).toBeDisabled(),
    );
    resolveFn();
    await waitFor(() =>
      expect(screen.getByTestId("world-power-system-regenerate")).not.toBeDisabled(),
    );
  });

  it("respects the disabled prop and disables the button", () => {
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => {}}
        disabled
        testId="world-power-system-regenerate"
      />,
    );
    expect(screen.getByTestId("world-power-system-regenerate")).toBeDisabled();
  });

  it("uses `section-regenerate-${target}` as the default testId", () => {
    render(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => {}}
      />,
    );
    expect(screen.getByTestId("section-regenerate-力量体系")).toBeInTheDocument();
  });
});
