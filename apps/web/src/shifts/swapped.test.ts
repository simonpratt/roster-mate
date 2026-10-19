import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { db, type OutboxRow, type ShiftChangeRow } from "../db";
import type { ShiftCode } from "./codes";
import { importedCodes, swappedFrom, useImportedCodes } from "./swapped";

const change = (
  rev: number,
  date: string,
  from: ShiftCode | null,
  to: ShiftCode | null,
  source: ShiftChangeRow["source"],
): ShiftChangeRow => ({ rev, date, from, to, source, editedAt: rev });

const pending = (date: string, code: ShiftCode, source: OutboxRow["source"]): OutboxRow => ({
  date,
  code,
  editedAt: 1,
  source,
});

/** Whether the date's shift, now `code`, is swapped given these changes and pending edits. */
function swapped(code: ShiftCode, changes: ShiftChangeRow[], outbox: OutboxRow[] = []): ShiftCode | null {
  return swappedFrom(code, importedCodes(changes, outbox).get("2026-10-21"));
}

describe("swapped", () => {
  it("is swapped from L when the latest import saved L and the shift is now E", () => {
    expect(swapped("E", [change(1, "2026-10-21", null, "L", "import"), change(2, "2026-10-21", "L", "E", "sheet")])).toBe(
      "L",
    );
  });

  it("is not swapped once the shift is set back to the imported code", () => {
    expect(
      swapped("L", [
        change(1, "2026-10-21", null, "L", "import"),
        change(2, "2026-10-21", "L", "E", "sheet"),
        change(3, "2026-10-21", "E", "L", "sheet"),
      ]),
    ).toBeNull();
  });

  it("is not swapped after a newer import saves the shift's code", () => {
    const changes = [
      change(1, "2026-10-21", null, "L", "import"),
      change(2, "2026-10-21", "L", "E", "sheet"),
      change(3, "2026-10-21", "E", "N", "import"),
    ];
    expect(swapped("N", changes)).toBeNull();
    // The highest rev wins, whatever order the rows come in.
    expect(swapped("L", [...changes].reverse())).toBe("N");
  });

  it("is never swapped on a date no import has saved", () => {
    expect(swapped("E", [])).toBeNull();
    expect(swapped("E", [change(1, "2026-10-21", null, "L", "sheet"), change(2, "2026-10-21", "L", "E", null)])).toBeNull();
    expect(swapped("E", [change(1, "2026-10-22", null, "L", "import")])).toBeNull();
  });

  it("counts a pending import edit as the latest import", () => {
    const changes = [change(1, "2026-10-21", null, "L", "import")];
    expect(swapped("E", changes, [pending("2026-10-21", "E", "import")])).toBeNull();
    expect(swapped("D", changes, [pending("2026-10-21", "E", "import")])).toBe("E");
    // A pending sheet edit, restore or unknown source sets no imported code.
    expect(swapped("E", changes, [pending("2026-10-21", "E", "sheet")])).toBe("L");
    expect(swapped("E", changes, [pending("2026-10-21", "E", "restore")])).toBe("L");
    expect(swapped("E", changes, [pending("2026-10-21", "E", undefined)])).toBe("L");
  });

  it("is never swapped without a code", () => {
    expect(swappedFrom(null, "L")).toBeNull();
    expect(swappedFrom(undefined, "L")).toBeNull();
    expect(swappedFrom("E", null)).toBeNull();
  });
});

describe("useImportedCodes", () => {
  it("reads the synced shift changes and the pending edits", async () => {
    await db.shiftChanges.bulkPut([change(1, "2026-10-21", null, "L", "import"), change(2, "2026-10-22", null, "D", "import")]);
    await db.outbox.put(pending("2026-10-22", "N", "import"));
    const { result } = renderHook(() => useImportedCodes());
    await waitFor(() =>
      expect(result.current).toEqual(
        new Map([
          ["2026-10-21", "L"],
          ["2026-10-22", "N"],
        ]),
      ),
    );
  });
});
