import AIConsoleView from './AIConsoleView';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AIConsoleModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-auto h-[90vh] w-[min(1200px,96vw)]">
        <AIConsoleView onClose={onClose} />
      </div>
    </div>
  );
}