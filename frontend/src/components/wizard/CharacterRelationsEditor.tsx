import { Character, RelationStatus } from "../../api/client";

interface Props {
  relations: Record<string, RelationStatus>;
  allCharacters: Character[];
  selfId: string;
  onChange: (next: Record<string, RelationStatus>) => void;
}

export default function CharacterRelationsEditor({ relations }: Props) {
  return (
    <div data-testid="relations-editor-placeholder" className="text-system-log/50 text-xs">
      关系编辑器（Task 4 实现）
      <ul>{Object.keys(relations).map((k) => <li key={k}>{k}</li>)}</ul>
    </div>
  );
}