import { useParams, Navigate } from "react-router-dom";
import InitWizardModal from "../components/wizard/InitWizardModal";

export default function WizardDeepLinkPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-canvas-bg">
      <InitWizardModal
        projectId={projectId}
        onDismiss={() => {
          window.location.assign(`/project/${encodeURIComponent(projectId)}/workspace?mode=manual`);
        }}
      />
    </div>
  );
}