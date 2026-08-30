import { useNavigate } from "react-router-dom";
import PromptPlazaView from "../components/home/promptPlaza/PromptPlazaView";

export default function PromptPlazaPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 min-h-0 flex-col py-6">
      <div className="flex-1 min-h-0">
        <PromptPlazaView projectId={null} projectTitle={null} onClose={() => navigate("/")} />
      </div>
    </div>
  );
}