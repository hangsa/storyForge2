interface CircuitBreakerProps {
  title: string;
  message: string;
  userOptions: Array<{
    label: string;
    action: () => void;
    variant?: "primary" | "danger" | "default";
  }>;
}

export default function CircuitBreaker({ title, message, userOptions }: CircuitBreakerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas-bg/80 backdrop-blur-sm">
      <div className="bg-surface-container-low border border-error-p0/50 rounded-none max-w-lg w-full mx-4">
        {/* Terminal-style header */}
        <div className="bg-error-p0/10 border-b border-error-p0/30 px-4 py-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-error-p0">warning</span>
          <span className="font-label-mono text-error-p0 uppercase">电路熔断 — Circuit Breaker</span>
        </div>

        <div className="p-6">
          <h2 className="font-display text-lg text-error-p0 mb-2">{title}</h2>
          <p className="font-body-ui text-system-log mb-6">{message}</p>

          <div className="flex gap-3">
            {userOptions.map((opt, i) => {
              const variantStyles =
                opt.variant === "danger"
                  ? "bg-error-p0/20 text-error-p0 border-error-p0/30 hover:bg-error-p0/30"
                  : opt.variant === "primary"
                  ? "bg-primary-container/10 text-primary-container border-primary-container/30 hover:bg-primary-container/20"
                  : "bg-surface-container text-system-log border-outline-variant hover:text-primary";

              return (
                <button
                  key={i}
                  onClick={opt.action}
                  className={`px-4 py-2 font-body-ui rounded border transition-colors ${variantStyles}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
