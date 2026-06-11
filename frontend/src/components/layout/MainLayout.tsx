import { Outlet, useParams, useLocation } from "react-router-dom";
import TopHeader from "./TopHeader";
import SideNavBar from "./SideNavBar";

const STAGE_FROM_PATH: Record<string, string> = {
  stage1: "STAGE1",
  stage2: "STAGE2",
  stage3: "STAGE3",
  stage4: "STAGE4",
};

export default function MainLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();

  const pathStage = location.pathname.split("/").pop() || "";
  const currentStage = STAGE_FROM_PATH[pathStage] || "INIT";

  return (
    <div className="min-h-screen bg-canvas-bg">
      <TopHeader
        projectName={projectId || "StoryForge"}
        currentStage={currentStage}
        collaborationMode="live"
        autoSaveStatus="saved"
      />
      <SideNavBar currentStage={currentStage} onNavigate={() => {}} />
      <main className="ml-[280px] mt-16 p-6">
        <Outlet />
      </main>
    </div>
  );
}
