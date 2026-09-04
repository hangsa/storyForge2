import PlotCanvasPage from "../../pages/PlotCanvasPage";

interface Props {
  projectId: string;
}

/**
 * Wizard-side wrapper around PlotCanvasPage. Owns the
 * `plot-canvas-mount-point` testid anchor that WorkspaceWizardPanel
 * tests assert on step-6 navigation. The page itself is now
 * standalone-only (no embedded/onCommitSuccess props) — the wizard's
 * prefill flow picks up `canvas.committed=true` from disk and marks
 * step 6 done, so no callback wiring is needed here.
 */
export default function PlotCanvasMountPoint({ projectId }: Props) {
  return (
    <div
      data-testid="plot-canvas-mount-point"
      data-project-id={projectId}
    >
      <PlotCanvasPage projectId={projectId} />
    </div>
  );
}
