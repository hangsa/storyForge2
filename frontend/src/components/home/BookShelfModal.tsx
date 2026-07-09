import { ProjectSummary } from "../../api/client";

interface BookShelfModalProps {
  projects: ProjectSummary[];
  onClose: () => void;
}

export default function BookShelfModal({ projects, onClose }: BookShelfModalProps) {
  return (
    <div data-testid="book-shelf-modal">
      {projects.map((p) => (
        <div key={p.id}>{p.title}</div>
      ))}
      <button onClick={onClose}>close</button>
    </div>
  );
}