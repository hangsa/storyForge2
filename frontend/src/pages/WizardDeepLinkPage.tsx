import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Redirect-only shell. The init wizard now lives inside the workspace as
 * <WorkspaceWizardPanel> on /project/:projectId/workspace?tab=settings, so the
 * legacy /project/:projectId/wizard deep link just forwards there.
 *
 * Navigation is SPA-only (never window.location.assign): a hard reload here
 * used to race finishWizard's navigate(...workspace...) and dump users on "/".
 */
export default function WizardDeepLinkPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (projectId) {
      navigate(`/project/${encodeURIComponent(projectId)}/workspace?tab=settings`, {
        replace: true,
      });
    } else {
      navigate("/", { replace: true });
    }
  }, [projectId, navigate]);

  return null;
}
