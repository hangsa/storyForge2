import { useNavigate } from "react-router-dom";
import AIConsoleView from "../components/aiConsole/AIConsoleView";

export default function AIConsolePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 min-h-0 flex-col px-8 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl text-primary">AI 控制台</h1>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm text-canvas-text-muted hover:text-canvas-text hover:bg-canvas-surface transition-colors"
        >
          ← 返回书架
        </button>
      </header>
      <div className="flex-1 min-h-0">
        <AIConsoleView onClose={() => navigate("/")} />
      </div>
    </div>
  );
}