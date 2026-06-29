import { useToast, Toast } from "../../hooks/useToast";
import { TOAST_AUTO_DISMISS_MS } from "../../types/stage4";
import { useEffect } from "react";

const MAX_VISIBLE = 3;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, toast.createdAt]);

  return (
    <div
      role="status"
      className="toast-item"
      onClick={() => {
        toast.onClick?.();
        onDismiss(toast.id);
      }}
      style={{ cursor: toast.onClick ? "pointer" : "default" }}
    >
      {toast.message}
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();
  // Show only the most recent N; older ones are dropped (they were shown long enough).
  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 70,
      }}
    >
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}