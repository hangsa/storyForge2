import { RegistryAsset } from "../../api/client";
import StatusBadge from "./StatusBadge";

interface RegistryCardProps {
  asset: RegistryAsset;
  registryType: string;
}

const TYPE_SPECIFIC_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  conflict: [
    { key: "owner", label: "主体" },
    { key: "target", label: "目标" },
    { key: "intensity", label: "强度" },
  ],
  mystery: [
    { key: "owner", label: "关联角色" },
    { key: "type", label: "类型" },
  ],
  twist: [
    { key: "owner", label: "关联角色" },
    { key: "type", label: "类型" },
  ],
  goal: [
    { key: "owner", label: "角色" },
    { key: "intensity", label: "优先级" },
  ],
};

export default function RegistryCard({ asset, registryType }: RegistryCardProps) {
  const extraFields = TYPE_SPECIFIC_FIELDS[registryType] || [];

  return (
    <div className="p-4 bg-surface-container rounded-lg border border-outline-variant hover:border-primary-container/30 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <code className="text-xs font-mono text-primary-container">{asset.id}</code>
        <StatusBadge status={asset.status} />
      </div>

      {asset.description && (
        <p className="text-sm text-system-log leading-relaxed mb-3">
          {asset.description}
        </p>
      )}

      {extraFields.some((f) => asset[f.key]) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-system-log/50">
          {extraFields
            .filter((f) => asset[f.key])
            .map((f) => (
              <span key={f.key}>
                <span className="text-system-log/40">{f.label}: </span>
                <span className="text-system-log/70">{String(asset[f.key])}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
