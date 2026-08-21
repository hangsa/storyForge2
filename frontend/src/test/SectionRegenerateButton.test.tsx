import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SectionRegenerateButton } from "../components/shared/SectionRegenerateButton";
import { ToastProvider } from "../hooks/useToast";
import { WizardProvider, type WizardRegenerateState, useWizard } from "../components/wizard/WizardContext";

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Renders a Spy component alongside the button so the test can observe the
 *  wizard's regenerate state without having to dispatch through the visible UI. */
function renderWithWizardSpy(props: {
  onRegenerate: () => Promise<void>;
  target: string;
  testId: string;
}) {
  let captured: WizardRegenerateState = { kind: "idle" };
  function Spy() {
    const w = useWizard();
    captured = w.regenerateState;
    return null;
  }
  renderWithToast(
    <WizardProvider projectId="proj_x">
      <Spy />
      <SectionRegenerateButton
        target={props.target}
        testId={props.testId}
        onRegenerate={props.onRegenerate}
      />
    </WizardProvider>,
  );
  return () => captured;
}

describe("SectionRegenerateButton", () => {
  it("renders an icon button with the section's test id", () => {
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={async () => {}}
          testId="world-power-system-regenerate"
        />
      </WizardProvider>,
    );
    const btn = screen.getByTestId("world-power-system-regenerate");
    expect(btn).toBeInTheDocument();
  });

  it("opens the RegenerateModal when clicked", () => {
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={async () => {}}
          testId="world-power-system-regenerate"
        />
      </WizardProvider>,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    expect(screen.getByTestId("regenerate-modal")).toBeInTheDocument();
    // Modal title includes the target.
    expect(screen.getByText(/重新生成 — 力量体系/)).toBeInTheDocument();
  });

  it("calls onRegenerate with the typed text on confirm", async () => {
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={onRegenerate}
          testId="world-power-system-regenerate"
        />
      </WizardProvider>,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.change(screen.getByLabelText("修改意见"), {
      target: { value: "更紧凑" },
    });
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledWith("更紧凑"));
  });

  it("reports success to wizard regenerateState when onRegenerate resolves", async () => {
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    const getState = renderWithWizardSpy({
      target: "力量体系",
      testId: "world-power-system-regenerate",
      onRegenerate,
    });
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(getState()).toEqual({
        kind: "success",
        target: "力量体系",
        at: expect.any(Number),
      }),
    );
  });

  it("reports failure with the error message when onRegenerate rejects", async () => {
    const onRegenerate = vi.fn().mockRejectedValue(new Error("LLM 拒绝"));
    const getState = renderWithWizardSpy({
      target: "力量体系",
      testId: "world-power-system-regenerate",
      onRegenerate,
    });
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    await waitFor(() =>
      expect(getState()).toEqual({
        kind: "failure",
        target: "力量体系",
        message: "LLM 拒绝",
        at: expect.any(Number),
      }),
    );
  });

  it("closes the modal on cancel without calling onRegenerate", () => {
    const onRegenerate = vi.fn();
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={onRegenerate}
          testId="world-power-system-regenerate"
        />
      </WizardProvider>,
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
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={onRegenerate}
          testId="world-power-system-regenerate"
        />
      </WizardProvider>,
    );
    fireEvent.click(screen.getByTestId("world-power-system-regenerate"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));
    // While in flight the icon swaps to a spinner and the icon button is disabled.
    await waitFor(() =>
      expect(screen.getByTestId("world-power-system-regenerate-spinner")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("regenerate-modal-confirm-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-regenerate")).toBeDisabled();
    await act(async () => {
      resolveFn();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("world-power-system-regenerate-spinner")).not.toBeInTheDocument(),
    );
  });

  it("respects the disabled prop and disables the button", () => {
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={async () => {}}
          disabled
          testId="world-power-system-regenerate"
        />
      </WizardProvider>,
    );
    expect(screen.getByTestId("world-power-system-regenerate")).toBeDisabled();
  });

  it("uses `section-regenerate-${target}` as the default testId", () => {
    renderWithToast(
      <WizardProvider projectId="proj_x">
        <SectionRegenerateButton
          target="力量体系"
          onRegenerate={async () => {}}
        />
      </WizardProvider>,
    );
    expect(screen.getByTestId("section-regenerate-力量体系")).toBeInTheDocument();
  });

  it("does NOT call useWizard when statusReporter is provided", () => {
    // Sanity check: when statusReporter is passed, the button must not
    // require a WizardProvider wrapper. We render WITHOUT one and verify
    // no "useWizard must be used within WizardProvider" error is thrown.
    const onSuccess = vi.fn();
    renderWithToast(
      <SectionRegenerateButton
        target="概念"
        onRegenerate={async () => {}}
        statusReporter={{ onSuccess }}
      />,
    );
    expect(screen.getByTestId("section-regenerate-概念")).toBeInTheDocument();
  });
});

describe("SectionRegenerateButton with statusReporter (workspace path)", () => {
  it("calls onSuccess of statusReporter when onRegenerate resolves", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onBusy = vi.fn();

    renderWithToast(
      <SectionRegenerateButton
        target="概念"
        onRegenerate={async () => {}}
        statusReporter={{ onSuccess, onError, onBusy }}
      />,
    );

    fireEvent.click(screen.getByTestId("section-regenerate-概念"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("概念"));
    expect(onError).not.toHaveBeenCalled();
    expect(onBusy).toHaveBeenCalledWith("概念");
  });

  it("calls onError of statusReporter when onRegenerate rejects", async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    renderWithToast(
      <SectionRegenerateButton
        target="力量体系"
        onRegenerate={async () => { throw new Error("boom"); }}
        statusReporter={{ onSuccess, onError }}
      />,
    );

    fireEvent.click(screen.getByTestId("section-regenerate-力量体系"));
    fireEvent.click(screen.getByTestId("regenerate-modal-confirm"));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("力量体系", expect.stringContaining("boom")),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
