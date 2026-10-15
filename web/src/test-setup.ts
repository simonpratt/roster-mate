import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { clearAll } from "./db";
import { sync } from "./sync/engine";

afterEach(async () => {
  cleanup();
  // Let any sync the test started finish, then start the next test from an empty phone.
  await sync.idle();
  await clearAll();
  sync.reset();
});
