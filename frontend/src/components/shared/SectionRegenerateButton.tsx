import { useContext, useState } from "react";
import { RegenerateModal } from "./RegenerateModal";
import { WizardContext } from "../wizard/WizardContext";

/**
 * Reusable regenerate flow extracted from `SectionRegenerateButton`. Owns the
 * open/busy state, calls `onRegenerate`, and surfaces success/failure to the
 * wizard footer status badge (via wizard context) OR a custom reporter.
 *
 * Two integration patterns:
 *
 *   1. `<SectionRegenerateButton target onRegenerate testId>` — the original
 *      component, which renders a self-contained `<button>` (or `<span
 *      role="button">` when `nested=true`). This is what every existing call
 *      site uses today.
 *
 *   2. `useSectionRegenerate(...)` returning `{ triggerProps, modal }` — the
 *      raw pieces, for places where the regenerate affordance must live
 *      INSIDE another element (e.g., inside `<button role="tab">`, where
 *      nesting a real `<button>` would violate the "no interactive content
 *      in a button" HTML rule). The caller renders `<span role="button"
 *      {...triggerProps}>↻</span>` and drops `{modal}` somewhere outside.
 *
 * Both paths share the same wizard footer status reporting, so the footer
 * badge works identically regardless of which pattern a step uses.
 */
export interface SectionRegenerateOptions {
  /** Modal title suffix, e.g. "力量体系". */
  target: string;
  /**
   * Called with the user's modification text on confirm. Should resolve on
   * success and reject on failure (so the footer status can surface the
   * result). On failure, the parent should ALSO call wizard.setStatus("error", ...)
   * to render the durable in-form error banner.
   */
  onRegenerate: (userModifications: string) => Promise<void>;
  /** Disables the icon while the parent is busy for an unrelated reason. */
  disabled?: boolean;
  /**
   * 工作区使用：传入自定义 reporter（通常用 useToast 包装）。
   * 不传则 fallback useWizard()，保持现有 wizard 行为不变。
   */
  statusReporter?: {
    onBusy?: (target: string) => void;
    onSuccess?: (target: string) => void;
    onError?: (target: string, message: string) => void;
  };
}

export interface SectionRegenerateTriggerProps {
  "data-testid": string;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /**
   * Spreads `disabled` only when truthy. The HTML `disabled` attribute is
   * invalid on `<span>` (only valid on form elements), but the wizard path
   * `<button>` consumers rely on it to gate form submission. Callers that
   * render the trigger as `<span role="button">` (e.g., WorldStep's nested
   * tab affordance) should use `aria-disabled` + `data-disabled` instead —
   * both are exported below.
   */
  disabled?: boolean;
  /** Always set; valid on any element. */
  "aria-disabled"?: boolean;
  /** CSS hook for `[data-disabled="true"]` opacity / cursor styling on non-button elements. */
  "data-disabled"?: "true" | undefined;
  /** Tab-reachable when truthy; spans need this because browsers don't auto-focus them. */
  tabIndex?: number;
  "aria-label": string;
  title: string;
  className: string;
}

export interface UseSectionRegenerateResult {
  /** Spread these onto the affordance element (button OR span role="button"). */
  triggerProps: SectionRegenerateTriggerProps;
  /** Renders the RegenerateModal; drop somewhere outside the trigger's ancestor. */
  modal: React.ReactNode;
  /** True while the LLM call is in flight; use to swap icon to spinner. */
  busy: boolean;
}

/**
 * Hook API for places where the trigger must be a child of another interactive
 * element (e.g., embedded inside a tab button). All other call sites should
 * continue using `<SectionRegenerateButton>` for backward compatibility.
 *
 * The trigger element is the caller's responsibility — the hook never
 * enforces that you used a `<button>` vs `<span role="button">`. Pass
 * `triggerProps.onClick` through (it calls `e.stopPropagation()` so the click
 * doesn't bubble to the outer button), and pair it with `triggerProps.onKeyDown`
 * to keep Enter/Space working.
 */
export function useSectionRegenerate(
  options: SectionRegenerateOptions & { testId: string },
): UseSectionRegenerateResult {
  const { target, onRegenerate, disabled = false, testId, statusReporter } = options;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Reporting success/failure through wizard.regenerateState renders an
  // inline status badge in the wizard footer (positioned before "重新生成"),
  // instead of the previous global toast at viewport bottom-right which
  // overlapped the footer buttons when the modal was short.
  //
  // useWizard() is called UNCONDITIONALLY (Rules of Hooks). When a
  // statusReporter is provided, the wizard context is ignored at the call
  // sites below — `wizard` is just never read. `useOptionalWizard` would
  // still throw if the provider is missing, so we deliberately use
  // `useContext(WizardContext)` directly: returns null when no provider is
  // mounted (workspace path renders outside the wizard), which is exactly
  // what we want here.
  const wizard = useContext(WizardContext);

  const reportBusy = (t: string) => {
    if (statusReporter?.onBusy) statusReporter.onBusy(t);
    else wizard?.setRegenerateBusy(t);
  };
  const reportSuccess = (t: string) => {
    if (statusReporter?.onSuccess) statusReporter.onSuccess(t);
    else wizard?.setRegenerateSuccess(t);
  };
  const reportError = (t: string, m: string) => {
    if (statusReporter?.onError) statusReporter.onError(t, m);
    else wizard?.setRegenerateFailure(t, m);
  };

  const handleConfirm = async (text: string) => {
    setBusy(true);
    reportBusy(target);
    try {
      await onRegenerate(text);
      reportSuccess(target);
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reportError(target, msg);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const openModal = (e?: React.SyntheticEvent) => {
    // stopPropagation lets this trigger sit inside another button (e.g., the
    // tab button) without the outer button's click handler firing. The outer
    // button's onClick (tab-change) would otherwise steal the click.
    e?.stopPropagation();
    setOpen(true);
  };

  const triggerProps: SectionRegenerateTriggerProps = {
    "data-testid": testId,
    onClick: openModal,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openModal(e);
      }
    },
    // `disabled` is only valid on form elements (button/input/select). When
    // spread onto a `<span role="button">` it does nothing visually AND it
    // leaves the element keyboard-focusable, which contradicts the intent.
    // We expose BOTH shapes — the wizard `<button>` consumer spreads
    // `triggerProps` and gets `disabled`; the wizard span / workspace path
    // can opt into `aria-disabled` + `data-disabled` for CSS-based styling.
    disabled: disabled || busy,
    "aria-disabled": disabled || busy,
    "data-disabled": disabled || busy ? "true" : undefined,
    // Spans don't participate in Tab order by default — explicit tabIndex
    // makes the affordance keyboard-reachable when rendered as a span.
    tabIndex: disabled || busy ? -1 : 0,
    "aria-label": `重新生成 — ${target}`,
    title: `重新生成 — ${target}`,
    className:
      "inline-flex items-center justify-center h-6 w-6 rounded text-system-log/50 hover:text-primary-container hover:bg-surface-container transition-colors disabled:cursor-not-allowed disabled:opacity-40",
  };

  const modal = (
    <RegenerateModal
      open={open}
      target={target}
      onConfirm={handleConfirm}
      onCancel={() => setOpen(false)}
      busy={busy}
    />
  );

  return { triggerProps, modal, busy };
}

interface SectionRegenerateButtonProps extends SectionRegenerateOptions {
  /** Test id; default `section-regenerate-${target}`. */
  testId?: string;
}

export function SectionRegenerateButton({
  target,
  onRegenerate,
  disabled = false,
  testId,
  statusReporter,
}: SectionRegenerateButtonProps) {
  const { triggerProps, modal, busy } = useSectionRegenerate({
    target,
    onRegenerate,
    disabled,
    statusReporter,
    testId: testId ?? `section-regenerate-${target}`,
  });

  return (
    <>
      <button
        type="button"
        {...triggerProps}
      >
        <span
          className={`material-symbols-outlined text-[14px]${busy ? " animate-spin text-primary-container" : ""}`}
          data-testid={busy ? `${triggerProps["data-testid"]}-spinner` : undefined}
        >
          {busy ? "progress_activity" : "refresh"}
        </span>
      </button>
      {modal}
    </>
  );
}