interface Props {
  projectId: string;
}

/**
 * Task 3 placeholder for the canvas step-1 mount point.
 *
 * Task 4 (creative-canvas/CreativeCanvasMountPoint + page embedded prop)
 * will replace this stub with the full wizard-context-aware wrapper that
 * wires setActiveStep1Surface, markStep1SurfaceCompleted, and the
 * embedded-vs-fullscreen distinction.
 *
 * For now this only exists so the WorkspaceWizardPanel step-1 render
 * branch can mount and the post-integration tests can assert
 * `data-testid="creative-canvas-mount-point"` is in the document.
 */
export default function CreativeCanvasMountPoint({ projectId }: Props) {
  return (
    <div data-testid="creative-canvas-mount-point" data-project-id={projectId}>
      {/* Stub — replaced in Task 4 */}
    </div>
  );
}
