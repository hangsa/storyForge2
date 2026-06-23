import "@testing-library/jest-dom/vitest";

// Polyfill ResizeObserver for @xyflow/react in jsdom environment
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;