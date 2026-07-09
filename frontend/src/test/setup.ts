import "@testing-library/jest-dom/vitest";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

// Polyfill ResizeObserver for @xyflow/react in jsdom environment
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

// Polyfill localStorage as a global from jsdom's window.localStorage.
// Node 22+ doesn't expose localStorage as a Node global without --localstorage-file.
// jsdom provides it on its window, but vitest's populateGlobal doesn't copy it
// to globalThis because it's a prototype getter (not an own property).
// The jsdom instance is reachable via globalThis.jsdom, so we use that path.
if (
  typeof (globalThis as { localStorage?: Storage }).localStorage ===
    "undefined"
) {
  const jsdom = (globalThis as { jsdom?: { window?: { localStorage?: Storage } } })
    .jsdom;
  const ls = jsdom?.window?.localStorage;
  if (ls) {
    Object.defineProperty(globalThis, "localStorage", {
      value: ls,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}
