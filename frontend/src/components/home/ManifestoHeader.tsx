export default function ManifestoHeader() {
  return (
    <section
      data-testid="manifesto-header"
      className="text-center py-10 bg-gradient-to-b from-surface-container-lowest to-canvas-bg rounded-lg border border-outline-variant mb-8"
    >
      <h1 className="font-display text-3xl text-primary tracking-tight">
        叙事驱动的小说创作平台
      </h1>
      <p className="mt-3 font-body-ui text-system-log max-w-xl mx-auto px-6 text-sm">
        从一句话概念到百万字长篇。确定性骨架 + LLM 创意血肉，
        一站式管理概念、世界观、角色、大纲与场景写作。
      </p>
    </section>
  );
}