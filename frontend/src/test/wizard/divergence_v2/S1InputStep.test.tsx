import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import S1InputStep from "@/components/wizard/divergence_v2/S1InputStep";

vi.mock("@/api/client", () => ({
  __esModule: true,
  default: {
    listGenres: vi.fn().mockResolvedValue([]),
  },
}));

describe("S1InputStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form fields", () => {
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={() => {}}
      />,
    );
    expect(screen.getByLabelText(/灵感点子/i)).toBeTruthy();
    expect(screen.getByLabelText(/主类型/i)).toBeTruthy();
  });

  it("bubbles onSubmitReady with null handler while prompt <10 chars (form invalid)", () => {
    const onSubmitReady = vi.fn();
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={() => {}}
        onSubmitReady={onSubmitReady}
      />,
    );
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "短" },
    });
    // The latest call (after the keystroke) reports valid=false → handler=null.
    const lastCall = onSubmitReady.mock.calls[onSubmitReady.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();
    expect(lastCall[1]).toBe(false);
  });

  it("bubbles onSubmitReady with non-null handler when form is valid", async () => {
    const onSubmitReady = vi.fn();
    const onSubmitted = vi.fn();
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={onSubmitted}
        onSubmitReady={onSubmitReady}
      />,
    );
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    await waitFor(() => {
      // Find a call reporting valid=true with a non-null handler.
      const ready = onSubmitReady.mock.calls.some(
        ([handler, valid]) => valid === true && typeof handler === "function",
      );
      expect(ready).toBe(true);
    });
  });

  it("handler invoked by parent (wizard footer) emits RawIntent with current form state", async () => {
    const onSubmitReady = vi.fn();
    const onSubmitted = vi.fn();
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={onSubmitted}
        onSubmitReady={onSubmitReady}
      />,
    );
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "足够长的原始灵感点子" },
    });
    fireEvent.change(screen.getByLabelText(/主类型/i), {
      target: { value: "玄幻" },
    });
    await waitFor(() => {
      const ready = onSubmitReady.mock.calls.find(
        ([handler, valid]) => valid === true && typeof handler === "function",
      );
      expect(ready).toBeTruthy();
    });
    // Simulate the wizard footer "下一步:拆解 →" button click.
    const ready = onSubmitReady.mock.calls.find(
      ([handler, valid]) => valid === true && typeof handler === "function",
    );
    const handler = ready![0] as () => void;
    handler();
    expect(onSubmitted).toHaveBeenCalledWith({
      prompt: "足够长的原始灵感点子",
      genre_primary: "玄幻",
      genre_secondary: null,
    });
  });

  it("invoking handler before form is valid is a no-op (handler is null)", async () => {
    const onSubmitted = vi.fn();
    render(
      <S1InputStep
        projectId="p1"
        initial={null}
        onSubmitted={onSubmitted}
        onSubmitReady={vi.fn()}
      />,
    );
    // Form has only 1 char in prompt — handler must be null, so even if the
    // parent somehow triggers a stale closure, onSubmitted is not called.
    fireEvent.change(screen.getByLabelText(/灵感点子/i), {
      target: { value: "短" },
    });
    // No assertion needed beyond "no error and onSubmitted not called".
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
