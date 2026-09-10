import { useNavigate } from "react-router-dom";
import CreativeDimensionsView from "../components/creativeDimensions/CreativeDimensionsView";

export default function CreativeDimensionsPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 min-h-0 flex-col py-6">
      <div className="flex-1 min-h-0">
        <CreativeDimensionsView onClose={() => navigate("/")} />
      </div>
    </div>
  );
}
