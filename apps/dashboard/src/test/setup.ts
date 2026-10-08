import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Mantine が使うブラウザの機能（jsdom にはない）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  window.ResizeObserver = ResizeObserverStub;
  // jsdom には scrollTo がない（ルーターが、ページ移動のたびに呼ぶ）
  window.scrollTo = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
