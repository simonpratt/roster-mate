import { describe, expect, it } from "vitest";
import { babysitterInitials, babysitterSections, dateLabel, datesText, type DatedBabysitter } from "./babysitters";

describe("babysitterInitials", () => {
  it("is the first letter, uppercased, when no other name shares it", () => {
    expect(babysitterInitials("Mum", ["Mum"])).toBe("M");
    expect(babysitterInitials("Mum", [])).toBe("M");
    expect(babysitterInitials("aunty bec", ["aunty bec", "Dad"])).toBe("A");
  });

  it("is two letters, Xx, when another known name starts with the same letter ignoring case", () => {
    expect(babysitterInitials("Mum", ["Mel", "Mum"])).toBe("Mu");
    expect(babysitterInitials("Mel", ["Mel", "Mum"])).toBe("Me");
    expect(babysitterInitials("mum", ["MEL", "mum"])).toBe("Mu");
    expect(babysitterInitials("MUM", ["Mel"])).toBe("Mu");
  });

  it("doesn't count the same name in another case as a clash", () => {
    expect(babysitterInitials("Mum", ["MUM", "mum", "Dad"])).toBe("M");
  });

  it("handles a one-letter name and letters beyond ASCII", () => {
    expect(babysitterInitials("J", ["Jo"])).toBe("J");
    expect(babysitterInitials("élodie", ["Dad"])).toBe("É");
  });
});

describe("dateLabel", () => {
  const base = { date: "2026-11-06", code: "L" as const, needsBabysitter: false, events: 0, today: "2026-11-01" };

  it("reads like a calendar cell", () => {
    expect(dateLabel({ ...base, babysitter: { name: "Mum", confirmed: true } })).toBe(
      "Friday 6 November, Late, babysitter Mum, confirmed",
    );
    expect(dateLabel({ ...base, babysitter: { name: "Mum", confirmed: false }, events: 2 })).toBe(
      "Friday 6 November, Late, babysitter Mum, tentative, 2 events",
    );
    expect(dateLabel({ ...base, babysitter: { name: "", confirmed: false }, needsBabysitter: true, events: 1 })).toBe(
      "Friday 6 November, Late, no babysitter, 1 event",
    );
    expect(dateLabel({ ...base, code: null, babysitter: { name: "", confirmed: false }, today: "2026-11-06" })).toBe(
      "Friday 6 November, no shift, today",
    );
  });
});

describe("babysitterSections", () => {
  const d = (date: string, name: string, confirmed = false): DatedBabysitter => ({ date, name, confirmed, code: "D" });

  it("groups names ignoring case, A–Z, each earliest first, and counts tentative dates", () => {
    const sections = babysitterSections([
      d("2026-11-20", "mum", true),
      d("2026-11-18", "Mum"),
      d("2026-11-19", "Dad", true),
      d("2026-11-21", ""),
      d("2026-11-17", "aunty bec"),
    ]);
    expect(sections.map((s) => [s.name, s.dates.map((x) => x.date), s.tentative])).toEqual([
      ["aunty bec", ["2026-11-17"], 1],
      ["Dad", ["2026-11-19"], 0],
      ["Mum", ["2026-11-18", "2026-11-20"], 1],
    ]);
  });

  it("is empty with no babysitters", () => {
    expect(babysitterSections([])).toEqual([]);
  });
});

describe("datesText", () => {
  it("counts dates", () => {
    expect(datesText(1)).toBe("1 date");
    expect(datesText(2)).toBe("2 dates");
  });
});
