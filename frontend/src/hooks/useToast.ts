import { createContext, useCallback, useContext, useMemo, useState, ReactNode, createElement } from "react";

export interface Toast {
  id: string;
  message: string;
  onClick?: () => void;
  // Created at; ToastContainer uses this plus TOAST_AUTO_DISMISS_MS for auto-dismiss.
  createdAt: number;
}

interface ShowOptions {
  onClick?: () => void;
}

interface ToastContextValue {
  toasts: Toast[];
  show: (message: string, options?: ShowOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `t_${idCounter}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, options?: ShowOptions): string => {
    const id = nextId();
    setToasts((prev) => [
      ...prev,
      { id, message, onClick: options?.onClick, createdAt: Date.now() },
    ]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);
  return createElement(ToastContext.Provider, { value }, children);
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}