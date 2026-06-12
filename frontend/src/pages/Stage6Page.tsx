import { useParams } from "react-router-dom";
import GlassPanel from "../components/shared/GlassPanel";

export default function Stage6Page() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-display text-white">导出中心</h2>
        <p className="text-system-log/50 mt-1 text-sm">
          将已完成的小说导出为 Markdown 文件
        </p>
      </div>
      <GlassPanel>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <span className="material-symbols-outlined text-5xl text-system-log/20">
            download
          </span>
          <p className="text-system-log/40">导出功能即将上线</p>
        </div>
      </GlassPanel>
    </div>
  );
}
