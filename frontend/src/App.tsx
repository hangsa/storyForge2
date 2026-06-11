import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import MainLayout from "./components/layout/MainLayout";
import InitPage from "./pages/InitPage";

const Stage1Page = lazy(() => import("./pages/Stage1Page"));
const Stage2Page = lazy(() => import("./pages/Stage2Page"));
const Stage3Page = lazy(() => import("./pages/Stage3Page"));
const Stage4Page = lazy(() => import("./pages/Stage4Page"));

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
      <Route path="/" element={<InitPage />} />
      <Route path="/init" element={<InitPage />} />
      <Route element={<MainLayout />}>
        <Route
          path="/project/:projectId/stage1"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <Stage1Page />
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage2"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <Stage2Page />
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage3"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <Stage3Page />
            </Suspense>
          }
        />
        <Route
          path="/project/:projectId/stage4"
          element={
            <Suspense fallback={<LoadingFallback />}>
              <Stage4Page />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

export default App;
