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
 * wizard via `markStep1SurfaceCompleted("canvas")` so step 2
 * (概念 DNA) unlocks.
 *
 * The `data-testid="creative-canvas-mount-point"` is part of the
 * wizard's render-branch public contract — WorkspaceWizardPanel tests
 * assert the sidebar item click switches the main area to the canvas
 * surface via this anchor.
 */
export default function CreativeCanvasMountPoint({ projectId }: Props) {
  const wizard = useWizard();
  return (
    <div
      data-testid="creative-canvas-mount-point"
      data-project-id={projectId}
    >
      <CreativeCanvasPage
        projectId={projectId}
        embedded
        onCommitSuccess={() => wizard.markStep1SurfaceCompleted("canvas")}
      />
    </div>
  );
}
