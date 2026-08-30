import { useNavigate } from "react-router-dom";
import AIConsoleView from "../components/aiConsole/AIConsoleView";

export default function AIConsolePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 min-h-0 flex-col py-6">
      <div className="flex-1 min-h-0">
        <AIConsoleView onClose={() => navigate("/")} />
      </div>
    </div>
  );
}