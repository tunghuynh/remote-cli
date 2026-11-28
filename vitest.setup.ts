import { afterEach } from 'vitest';

// Test files that declare `// @vitest-environment node` have no `window`; they skip the DOM
// setup entirely (and the cost of loading Testing Library) instead of paying for jsdom.
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  // Auto-cleanup only self-registers when vitest globals are enabled, and they are
  // not. Without this, a hook rendered in one test stays mounted — with its timers
  // and effects live — for the rest of the file.
  afterEach(cleanup);

  // jsdom ships neither `ResizeObserver` nor `DOMMatrixReadOnly`, and React Flow (the agent monitor's live graph) needs both:
  // the first to measure its boxes, the second to read the viewport's zoom. Minimal stand-ins, as the React Flow testing guide
  // suggests: nothing is ever measured, so tests give the boxes their size themselves (the graph does).
  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (!('DOMMatrixReadOnly' in window)) {
    class DOMMatrixReadOnlyStub {
      m22: number;

      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
        this.m22 = scale !== undefined ? Number(scale) : 1;
      }
    }
    window.DOMMatrixReadOnly = DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
  }

  // jsdom ships no `matchMedia`, and components that pick a layout from the
  // viewport call it during render. Report the desktop breakpoint, which is the
  // layout the sidebar row tests assert on.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
}
