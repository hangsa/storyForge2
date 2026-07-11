import { useState, useEffect, useCallback } from "react";
import { Outlet, useParams, useLocation, useMatch, useNavigate } from "react-router-dom";
import TopHeader from "./TopHeader";
import SideNavBar from "./SideNavBar";
import { useSidebar } from "../../hooks/useSidebar";
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
  "stage1/canvas": "STAGE1",
  "stage3/outline": "STAGE3",
  "stage3/branches": "STAGE3",
  workspace: "WORKSPACE",
  "workspace?mode=manual": "WORKSPACE",
  "workspace?mode=manual&panel=diagnosis": "WORKSPACE_DIAGNOSIS",
  "workspace?mode=manual&panel=export": "WORKSPACE_EXPORT",
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
  WORKSPACE: "workspace",
  WORKSPACE_DIAGNOSIS: "workspace",
  WORKSPACE_EXPORT: "workspace",
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

  const { collapsed, width, setWidthLive, commitWidth, toggle } = useSidebar();

  useEffect(() => {
    if (!projectId) return;
    api
      .getProjectStatus(projectId)
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
      if (stage === "WORKSPACE" || stage === "WORKSPACE_DIAGNOSIS" || stage === "WORKSPACE_EXPORT") {
        if (!projectId) return;
        let url = `/project/${projectId}/workspace`;
        if (stage === "WORKSPACE_DIAGNOSIS") url += "?mode=manual&panel=diagnosis";
        if (stage === "WORKSPACE_EXPORT") url += "?mode=manual&panel=export";
        navigate(url);
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
        collapsed={collapsed}
        onToggleSidebar={toggle}
      />
      <SideNavBar
        currentStage={currentStage}
        onNavigate={handleNavigate}
        collapsed={collapsed}
        width={width}
        onLiveWidthChange={setWidthLive}
        onCommitWidth={commitWidth}
      />
      <main
        style={{ marginLeft: collapsed ? 0 : width }}
        className="mt-16 p-6 transition-all duration-200"
      >
        <Outlet />
      </main>
    </div>
  );
}
