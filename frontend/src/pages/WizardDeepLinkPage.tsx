import { useParams, Navigate, useNavigate } from "react-router-dom";
import InitWizardModal from "../components/wizard/InitWizardModal";

export default function WizardDeepLinkPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  if (!projectId) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-canvas-bg">
      <InitWizardModal
        projectId={projectId}
        resume
        onDismiss={() => {
          // SPA navigation, NOT window.location.assign: the latter is a hard
          // reload and races against finishWizard's navigate(/workspace) call.
          // When onDismiss fired during step-6 completion, the hard reload
          // won and users landed on "/" instead of the workspace.
          navigate("/", { replace: true });
        }}
      />
    </div>
  );
}
