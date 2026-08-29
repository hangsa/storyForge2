import { useEffect } from "react";
import PromptPlazaView from "./PromptPlazaView";

interface Props {
  isOpen: boolean;
  /** When null, the modal edits global defaults (no project context).
   *  When set, the modal edits the given project's prompt overrides. */
  projectId: string | null;
  projectTitle: string | null;
  onClose: () => void;
}

export default function PromptPlazaModal({ isOpen, projectId, projectTitle, onClose }: Props) {
  // ESC close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="prompt-plaza-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
    >
      <div className="h-[85vh] w-full max-w-6xl">
        <PromptPlazaView projectId={projectId} projectTitle={projectTitle} onClose={onClose} />
      </div>
    </div>
  );
}