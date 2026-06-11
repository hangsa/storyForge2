import { Routes, Route } from "react-router-dom";
import MainLayout from "./components/layout/MainLayout";
import InitPage from "./pages/InitPage";
import Stage1Page from "./pages/Stage1Page";
import Stage2Page from "./pages/Stage2Page";
import Stage3Page from "./pages/Stage3Page";
import Stage4Page from "./pages/Stage4Page";

function App() {
  return (
    <Routes>
      <Route path="/" element={<InitPage />} />
      <Route path="/init" element={<InitPage />} />
      <Route element={<MainLayout />}>
        <Route path="/project/:projectId/stage1" element={<Stage1Page />} />
        <Route path="/project/:projectId/stage2" element={<Stage2Page />} />
        <Route path="/project/:projectId/stage3" element={<Stage3Page />} />
        <Route path="/project/:projectId/stage4" element={<Stage4Page />} />
      </Route>
    </Routes>
  );
}

export default App;
