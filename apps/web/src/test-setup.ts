import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { clearAll } from "./db";
import { sync } from "./sync/engine";

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
