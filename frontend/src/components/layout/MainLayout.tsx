import { useState, useEffect } from "react";
import { Outlet, useParams, useLocation, useMatch } from "react-router-dom";
import TopHeader from "./TopHeader";
import SideNavBar from "./SideNavBar";
import api from "../../api/client";

const STAGE_FROM_PATH: Record<string, string> = {
  stage1: "STAGE1",
  stage2: "STAGE2",
  stage3: "STAGE3",
  stage4: "STAGE4",
};

export default function MainLayout() {
  const { projectId: paramId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const match = useMatch("/project/:projectId/*");
  const projectId = match?.params.projectId || paramId || "";

  const [projectName, setProjectName] = useState("");

  const pathStage = location.pathname.split("/").pop() || "";
  const currentStage = STAGE_FROM_PATH[pathStage] || "INIT";

  useEffect(() => {
    if (!projectId) return;
    api.getProjectStatus(projectId)
      .then((status) => {
        if (status?.title) setProjectName(status.title);
      })
      .catch(() => {});
  }, [projectId]);

  return (
    <div className="min-h-screen bg-canvas-bg">
      <TopHeader
        projectName={projectName || projectId || "StoryForge"}
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
