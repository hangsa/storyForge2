import { lazy, Suspense } from "react";
import { Routes, Route, useParams, Navigate } from "react-router-dom";
import MainLayout from "./components/layout/MainLayout";
import HomeLayout from "./components/layout/HomeLayout";
import HomePage from "./pages/HomePage";
import AIConsolePage from "./pages/AIConsolePage";
import PromptPlazaPage from "./pages/PromptPlazaPage";
import StageErrorBoundary from "./components/shared/StageErrorBoundary";
import { ToastProvider } from "./hooks/useToast";
import ToastContainer from "./components/shared/ToastContainer";

const Stage1Page = lazy(() => import("./pages/Stage1Page"));
const Stage1Layout = lazy(() => import("./components/layout/Stage1Layout"));
const Stage2Page = lazy(() => import("./pages/Stage2Page"));
const Stage3Page = lazy(() => import("./pages/Stage3Page"));
const StyleSandboxPage = lazy(() => import("./pages/StyleSandboxPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ChapterReviewPage = lazy(() => import("./pages/ChapterReviewPage"));
const ImpactAnalysisPage = lazy(() => import("./pages/ImpactAnalysisPage"));
const StoryOSPage = lazy(() => import("./pages/StoryOSPage"));
const CreativeCanvasPage = lazy(() => import("./pages/CreativeCanvasPage"));
const BranchSimulationPage = lazy(() => import("./pages/BranchSimulationPage"));
const Stage3Layout = lazy(() => import("./components/layout/Stage3Layout"));
const WizardDeepLinkPage = lazy(() => import("./pages/WizardDeepLinkPage"));
const WorkspacePage = lazy(() => import("./pages/WorkspacePage"));

function StageWrapper({ children, name }: { children: React.ReactNode; name: string }) {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <StageErrorBoundary projectId={projectId} stageName={name}>
      {children}
    </StageErrorBoundary>
  );
}

function StageRedirect({ to }: { to: string }) {
  // Builds a destination URL from the matched :projectId param.
  // Use this instead of <Navigate to={`/project/:projectId/${to}`} /> —
  // React Router does NOT interpolate URL params into string `to` props.
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/project/${encodeURIComponent(projectId ?? "")}/${to}`} replace />;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="material-symbols-outlined text-3xl text-system-log/30 animate-spin">
        progress_activity
      </span>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <Routes>
      <Route element={<HomeLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/ai-console" element={<AIConsolePage />} />
        <Route path="/prompt-plaza" element={<PromptPlazaPage />} />
      </Route>
      <Route
        path="/project/:projectId/wizard"
        element={
          <Suspense fallback={<LoadingFallback />}>
            {/* Defense-in-depth: if a wizard step throws (e.g. malformed
                chapter outline crashing ChapterOutlineStep — proj_1a7d7fcf
                2026-08-23), the user previously saw a blank page with no
                recovery affordance. Wrap in StageErrorBoundary so they get
                the same CircuitBreaker fallback the /workspace and stage
                routes use, with 重试渲染 / 回退 buttons. */}
            <StageErrorBoundary stageName="wizard">
              <WizardDeepLinkPage />
            </StageErrorBoundary>
          </Suspense>
        }
      />
      {/* v1.8.1: /workspace is a top-level route (NOT nested in MainLayout).
          The workspace is the project's day-to-day hub — it has its own
          WorkspaceTopBar + h-screen layout, so it shouldn't inherit the
          SideNavBar / TopHeader / p-6 chrome that MainLayout wraps around
          legacy stage pages. */}
      <Route
        path="/project/:projectId/workspace"
        element={
          <Suspense fallback={<LoadingFallback />}>
            <StageWrapper name="workspace">
              <WorkspacePage />
            </StageWrapper>
          </Suspense>
        }
      />
      <Route element={<MainLayout />}>
        <Route
          path="/project/:projectId/stage1"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage1">
                <Stage1Layout />
              </StageWrapper>
            </Suspense>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<LoadingFallback />}>
                <Stage1Page />
              </Suspense>
            }
          />
          <Route
            path="canvas"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <StageWrapper name="stage1-canvas">
                  <CreativeCanvasPage />
                </StageWrapper>
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/project/:projectId/stage2"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage2">
                <Stage2Page />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage3"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage3">
                <Stage3Layout />
              </StageWrapper>
            </Suspense>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<LoadingFallback />}>
                <Stage3Page initialTab="novel-outline" />
              </Suspense>
            }
          />
          <Route
            path="outline"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <Stage3Page initialTab="outline" />
              </Suspense>
            }
          />
          <Route
            path="branches"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <StageWrapper name="stage3-branches">
                  <BranchSimulationPage />
                </StageWrapper>
              </Suspense>
            }
          />
        </Route>
        {/* Stage4–6 redirects → /workspace. Use replace, not push, so back-button goes to caller. */}
        <Route
          path="/project/:projectId/stage4"
          element={<StageRedirect to="workspace?mode=manual" />}
        />
        <Route
          path="/project/:projectId/stage5"
          element={<StageRedirect to="workspace?mode=manual&panel=diagnosis" />}
        />
        <Route
          path="/project/:projectId/stage6"
          element={<StageRedirect to="workspace?mode=manual&panel=export" />}
        />
        <Route
          path="/project/:projectId/style"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="style">
                <StyleSandboxPage />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/settings"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="settings">
                <SettingsPage />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/review"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="review">
                <ChapterReviewPage />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/impact"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="impact">
                <ImpactAnalysisPage />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/storyos"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="storyos">
                <StoryOSPage />
              </StageWrapper>
            </Suspense>
          }
        />
      </Route>
      </Routes>
      <ToastContainer />
    </ToastProvider>
  );
}

export default App;
