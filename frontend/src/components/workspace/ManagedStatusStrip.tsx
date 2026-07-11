interface Props {
  currentTask: string;
  queuePreview?: string;
}

export default function ManagedStatusStrip({ currentTask, queuePreview }: Props) {
  return (
    <div
      data-testid="status-strip"
      className="flex items-center gap-3 px-6 py-2 bg-primary-container/10 border-y border-primary-container/30 text-sm font-body-ui"
    >
      <span className="material-symbols-outlined text-primary-container animate-spin">progress_activity</span>
      <span className="text-primary">AI 正在 {currentTask}</span>
      {queuePreview && (
        <span className="text-system-log ml-auto truncate">{queuePreview}</span>
      )}
    </div>
  );
}
