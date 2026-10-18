import { afterEach, expect, it, vi } from "vitest";
import { newId, uuidFromBytes } from "./uuid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

it("formats random bytes as a canonical v4 UUID", () => {
  expect(uuidFromBytes(new Uint8Array(16).fill(0xff))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  expect(uuidFromBytes(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
});

it("falls back to getRandomValues where randomUUID is missing, as over plain HTTP", () => {
  const real = globalThis.crypto;
  vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) });
  const a = newId();
  expect(a).toMatch(UUID);
  expect(newId()).not.toBe(a);
});
