import { lazy, Suspense } from "react";
import { Routes, Route, useParams } from "react-router-dom";
import MainLayout from "./components/layout/MainLayout";
import ProjectListPage from "./pages/ProjectListPage";
import InitPage from "./pages/InitPage";
import StageErrorBoundary from "./components/shared/StageErrorBoundary";

const Stage1Page = lazy(() => import("./pages/Stage1Page"));
const Stage2Page = lazy(() => import("./pages/Stage2Page"));
const Stage3Page = lazy(() => import("./pages/Stage3Page"));
const Stage4Page = lazy(() => import("./pages/Stage4Page"));

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
      <Route path="/init" element={<InitPage />} />
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
      </Route>
    </Routes>
  );
}

export default App;
