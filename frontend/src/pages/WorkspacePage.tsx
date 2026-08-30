import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { useWorkspaceMode } from "../hooks/useWorkspaceMode";
import type { WorkspaceMode } from "../hooks/useWorkspaceMode";
import WorkspaceTopBar from "../components/workspace/WorkspaceTopBar";
import WorkspaceWritingPanel, {
  type WorkspaceWritingPanelHandle,
} from "../components/workspace/WorkspaceWritingPanel";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";

export default function WorkspacePage({ projectId: projectIdProp }: { projectId?: string } = {}) {
  const params = useParams<{ projectId: string }>();
  const projectId = projectIdProp ?? params.projectId ?? "";
  const navigate = useNavigate();
  const { mode, setMode } = useWorkspaceMode();

  // Page-level state — kept here because the TopBar and global modals need
  // it but the manuscript panel does not.
  const [projectName, setProjectName] = useState("加载中…");
  const [reloadKey, setReloadKey] = useState(0);

  // v1.9: AI 工具 dropdown opens the Prompt Plaza modal for THIS project
  // (not the most-recent project like the home page entry).
  const [plazaOpen, setPlazaOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);

  // The TopBar's mode-switcher (WorkspaceModeSwitcher) lives at the page
  // level as a sibling of the manuscript panel, but the panel owns the
  // mode-switch confirm / start modals (they need to react to manuscript
  // state like `takeOverChapter`). Forward the TopBar click through an
  // imperative handle on the panel — the ref is stable, so we don't
  // re-render the TopBar on every state change inside the panel.
  const panelRef = useRef<WorkspaceWritingPanelHandle>(null);
  const handleTopBarModeChange = (next: WorkspaceMode) => {
    panelRef.current?.requestModeChange(next);
  };

  // Project name load — best-effort. 404 redirects to "/" per spec
  // § Error Handling. Anything else is silently swallowed (page still
  // renders with the default "加载中…" title).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getProjectStatus(projectId)
      .then((s: { title?: string }) => {
        if (!cancelled && s?.title) setProjectName(s.title);
      })
      .catch((err: { response?: { status?: number }; status?: number }) => {
        if (cancelled) return;
        if (err?.response?.status === 404 || err?.status === 404) {
          navigate("/", { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate]);

  return (
    <div data-testid="workspace-page-shell" className="h-screen flex flex-col bg-canvas-bg">
      {/*
        TopBar tab switcher placeholder (Plan Task 10, 2026-08-30):
        Plan Task 12 wires real `activeTab` state + routes between
        <WorkspaceWizardPanel> and <WorkspaceWritingPanel>. For now we pass
        stub defaults so the TopBar's required props typecheck cleanly.
      */}
      <WorkspaceTopBar
        projectId={projectId}
        projectName={projectName}
        mode={mode}
        onModeChange={handleTopBarModeChange}
        onOpenPlaza={() => setPlazaOpen(true)}
        onOpenConsole={() => setConsoleOpen(true)}
        activeTab="settings"
        onTabChange={() => {}}
        manuscriptLocked={false}
      />

      <WorkspaceWritingPanel
        ref={panelRef}
        projectId={projectId}
        projectName={projectName}
        mode={mode}
        setMode={setMode}
        reloadKey={reloadKey}
        setReloadKey={setReloadKey}
      />

      <PromptPlazaModal
        isOpen={plazaOpen}
        projectId={projectId}
        projectTitle={projectName === "加载中…" ? null : projectName}
        onClose={() => setPlazaOpen(false)}
      />
      <AIConsoleModal
        isOpen={consoleOpen}
        onClose={() => setConsoleOpen(false)}
      />
    </div>
  );
}
