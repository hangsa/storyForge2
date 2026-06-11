import { Outlet } from "react-router-dom";
import TopHeader from "./TopHeader";
import SideNavBar from "./SideNavBar";

export default function MainLayout() {
  return (
    <div className="min-h-screen bg-canvas-bg">
      <TopHeader
        projectName="StoryForge"
        currentStage="INIT"
        collaborationMode="live"
        autoSaveStatus="saved"
      />
      <SideNavBar currentStage="INIT" onNavigate={() => {}} />
      <main className="ml-[280px] mt-16 p-6">
        <Outlet />
      </main>
    </div>
  );
}
