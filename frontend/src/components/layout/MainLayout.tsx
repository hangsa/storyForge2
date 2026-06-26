import { useState, useEffect, useCallback } from "react";
import { Outlet, useParams, useLocation, useMatch, useNavigate } from "react-router-dom";
import TopHeader from "./TopHeader";
import SideNavBar from "./SideNavBar";
import api from "../../api/client";

const STAGE_FROM_PATH: Record<string, string> = {
  stage1: "STAGE1",
  stage2: "STAGE2",
  stage3: "STAGE3",
  stage4: "STAGE4",
  stage5: "STAGE5",
  stage6: "STAGE6",
  style: "STYLE",
  settings: "SETTINGS",
  review: "REVIEW",
  impact: "IMPACT",
  storyos: "STORYOS",
  "stage1/canvas": "STAGE1_CANVAS",
  "stage3/outline": "STAGE3_OUTLINE",
  "stage3/branches": "STAGE3_BRANCHES",
};

const STAGE_TO_PATH: Record<string, string> = {
  STAGE1: "stage1",
  STAGE2: "stage2",
  STAGE3: "stage3",
  STAGE4: "stage4",
  STAGE5: "stage5",
  STAGE6: "stage6",
  STYLE: "style",
  SETTINGS: "settings",
  REVIEW: "review",
  IMPACT: "impact",
  STORYOS: "storyos",
  STAGE1_CANVAS: "stage1/canvas",
  STAGE3_OUTLINE: "stage3/outline",
  STAGE3_BRANCHES: "stage3/branches",
};

export default function MainLayout() {
  const { projectId: paramId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch("/project/:projectId/*");
  const projectId = match?.params.projectId || paramId || "";

  const [projectName, setProjectName] = useState("");

  const pathStage = match?.params["*"] || "";
  const currentStage = STAGE_FROM_PATH[pathStage] || "INIT";

  useEffect(() => {
    if (!projectId) return;
    api.getProjectStatus(projectId)
      .then((status) => {
        if (status?.title) setProjectName(status.title);
      })
      .catch(() => {});
  }, [projectId]);

  const handleNavigate = useCallback(
    (stage: string) => {
      if (stage === "dashboard") {
        navigate("/");
        return;
      }
      const path = STAGE_TO_PATH[stage];
      if (path && projectId) {
        navigate(`/project/${projectId}/${path}`);
      }
    },
    [projectId, navigate]
  );

  return (
    <div className="min-h-screen bg-canvas-bg">
      <TopHeader
        projectName={projectName || projectId || "StoryForge"}
        currentStage={currentStage}
        collaborationMode="live"
        autoSaveStatus="saved"
      />
      <SideNavBar currentStage={currentStage} onNavigate={handleNavigate} />
      <main className="ml-[280px] mt-16 p-6">
        <Outlet />
      </main>
    </div>
  );
}
