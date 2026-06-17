import { lazy, Suspense } from "react";
import { Routes, Route, useParams } from "react-router-dom";
import MainLayout from "./components/layout/MainLayout";
import ProjectListPage from "./pages/ProjectListPage";
import StageErrorBoundary from "./components/shared/StageErrorBoundary";

const Stage1Page = lazy(() => import("./pages/Stage1Page"));
const Stage2Page = lazy(() => import("./pages/Stage2Page"));
const Stage3Page = lazy(() => import("./pages/Stage3Page"));
const Stage4Page = lazy(() => import("./pages/Stage4Page"));
const Stage5Page = lazy(() => import("./pages/Stage5Page"));
const Stage6Page = lazy(() => import("./pages/Stage6Page"));
const StyleSandboxPage = lazy(() => import("./pages/StyleSandboxPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ChapterReviewPage = lazy(() => import("./pages/ChapterReviewPage"));
const ImpactAnalysisPage = lazy(() => import("./pages/ImpactAnalysisPage"));
const StoryOSPage = lazy(() => import("./pages/StoryOSPage"));

function StageWrapper({ children, name }: { children: React.ReactNode; name: string }) {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <StageErrorBoundary projectId={projectId} stageName={name}>
      {children}
    </StageErrorBoundary>
  );
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
    <Routes>
      <Route path="/" element={<ProjectListPage />} />
      <Route element={<MainLayout />}>
        <Route
          path="/project/:projectId/stage1"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage1">
                <Stage1Page />
              </StageWrapper>
            </Suspense>
          }
        />
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
                <Stage3Page />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage4"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage4">
                <Stage4Page />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage5"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage5">
                <Stage5Page />
              </StageWrapper>
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage6"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <StageWrapper name="stage6">
                <Stage6Page />
              </StageWrapper>
            </Suspense>
          }
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
  );
}

export default App;
