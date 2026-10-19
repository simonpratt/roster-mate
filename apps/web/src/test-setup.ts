import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { clearAll } from "./db";
import { sync } from "./sync/engine";

// A re-render of the Calendar's months in jsdom can take over a second on a busy CI runner;
// Testing Library's default 1 s for findBy and waitFor is too tight there.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no scrollTo; the Calendar's Today button uses it.
Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
  if (typeof options === "object" && options.top !== undefined) this.scrollTop = options.top;
} as Element["scrollTo"];

afterEach(async () => {
  cleanup();
  // Let any sync the test started finish, then start the next test from an empty phone.
  await sync.idle();
  await clearAll();
  sync.reset();
});
