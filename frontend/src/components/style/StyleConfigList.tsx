import type { SavedStyleConfig } from "../../api/client";

interface Props {
  configs: SavedStyleConfig[];
  onLoad: (cfg: SavedStyleConfig) => void;
}

export default function StyleConfigList({ configs, onLoad }: Props) {
  if (configs.length === 0) {
    return <p className="text-sm text-gray-500">暂无已保存的风格配置</p>;
  }
  return (
    <ul className="space-y-1" aria-label="已保存的风格配置">
      {configs.map((c) => (
        <li key={c.path}>
          <button
            type="button"
            onClick={() => onLoad(c)}
            className="text-sm text-indigo-700 hover:underline"
          >
            {c.name}
          </button>
          <span className="ml-2 text-xs text-gray-500">{c.created_at.slice(0, 10)}</span>
        </li>
      ))}
    </ul>
  );
}
