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
 * The wrapper keeps `data-testid="creative-canvas-mount-point"` so the
 * existing WorkspaceWizardPanel render-branch test continues to work —
 * it asserts the wizard sidebar item click switches the main area to
 * the canvas surface, and this testid is its anchor.
 *
 * Task 4 of 6 — canvas-wizard integration.
 * Spec: docs/superpowers/specs/2026-09-03-canvas-wizard-integration-design.md §4.3
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
