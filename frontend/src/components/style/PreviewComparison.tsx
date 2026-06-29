interface Props {
  sourceText: string;
  sourceAvgLength: number;
  renderedText: string;
  renderedAvgLength: number;
  skippedReason?: string;
}

export default function PreviewComparison({
  sourceText, sourceAvgLength, renderedText, renderedAvgLength, skippedReason,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-4" aria-label="对比预览">
      <section className="border rounded p-3">
        <h3 className="text-sm font-medium mb-1">原文</h3>
        <p className="text-xs text-gray-600 mb-2">平均句长：{sourceAvgLength.toFixed(1)} 字</p>
        <pre className="text-sm whitespace-pre-wrap">{sourceText}</pre>
      </section>
      <section className="border rounded p-3">
        <h3 className="text-sm font-medium mb-1">渲染结果</h3>
        {skippedReason ? (
          <p className="text-sm text-yellow-700">已跳过：{skippedReason}</p>
        ) : (
          <>
            <p className="text-xs text-gray-600 mb-2">平均句长：{renderedAvgLength.toFixed(1)} 字</p>
            <pre className="text-sm whitespace-pre-wrap">{renderedText}</pre>
          </>
        )}
      </section>
    </div>
  );
}
