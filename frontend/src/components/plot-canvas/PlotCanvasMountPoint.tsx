import { useWizard } from "../wizard/WizardContext";
import CreativeCanvasPage from "../../pages/CreativeCanvasPage";

interface Props {
  projectId: string;
}

/**
 * Wizard-side wrapper around CreativeCanvasPage. Owns the wizard
 * context dependency so the page itself stays standalone-capable
 * (i.e., still works at /project/:id/stage1/canvas without a
 * WizardProvider). When the user commits a path, we notify the
 * wizard via `markStepGenerated(6, {})` so step 6 (剧情画布) is
 * pushed into `completedSteps` immediately — without waiting for
 * the next prefill rerun to re-read canvas state from disk.
 *
 * The `data-testid="creative-canvas-mount-point"` is part of the
 * wizard's render-branch public contract — WorkspaceWizardPanel tests
 * assert the sidebar item click switches the main area to the canvas
 * surface via this anchor. (Task 11 will rename it to
 * `plot-canvas-mount-point`; intentionally preserved here.)
 */
export default function PlotCanvasMountPoint({ projectId }: Props) {
  const wizard = useWizard();
  return (
    <div
      data-testid="creative-canvas-mount-point"
      data-project-id={projectId}
    >
      <CreativeCanvasPage
        projectId={projectId}
        embedded
        onCommitSuccess={() => wizard.markStepGenerated(6, {})}
      />
    </div>
  );
}
