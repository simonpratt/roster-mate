import { describe, expect, it } from "vitest";
import {
  DUPLICATE_EMAIL,
  emailProblem,
  INVALID_EMAIL,
  lastSendText,
  recipientLabel,
  recipientSummary,
  serverProblem,
  withoutRecipient,
  withRecipient,
} from "./recipients";

const LIST = [
  { email: "nan.pop@example.com", babysitter: "Nan" },
  { email: "aunty.bec@example.com", babysitter: "" },
];

describe("emailProblem", () => {
  it("accepts an address like x@y.z, trimmed", () => {
    expect(emailProblem("  mum@example.com ", LIST, null)).toBeNull();
  });

  it.each(["", "mum", "mum@example", "@example.com", "mum @example.com", "mum@@example.com", `${"a".repeat(250)}@x.co`])(
    "rejects %j",
    (email) => {
      expect(emailProblem(email, LIST, null)).toBe(INVALID_EMAIL);
    },
  );

  it("rejects another recipient's address, ignoring case", () => {
    expect(emailProblem("Nan.Pop@Example.com", LIST, null)).toBe(DUPLICATE_EMAIL);
    expect(emailProblem("nan.pop@example.com", LIST, 1)).toBe(DUPLICATE_EMAIL);
  });

  it("lets a recipient keep its own address", () => {
    expect(emailProblem("NAN.POP@example.com", LIST, 0)).toBeNull();
  });
});

describe("list edits", () => {
  it("adds at the end, trimmed and lower case", () => {
    expect(withRecipient(LIST, null, { email: " Mum@Example.com ", babysitter: " Mum " })).toEqual([
      ...LIST,
      { email: "mum@example.com", babysitter: "Mum" },
    ]);
  });

  it("replaces in place", () => {
    expect(withRecipient(LIST, 1, { email: "aunty.bec@example.com", babysitter: "Bec" })).toEqual([
      LIST[0],
      { email: "aunty.bec@example.com", babysitter: "Bec" },
    ]);
  });

  it("removes by index", () => {
    expect(withoutRecipient(LIST, 0)).toEqual([LIST[1]]);
  });
});

describe("text", () => {
  it("summarises and labels a row", () => {
    expect(recipientSummary(LIST[0]!)).toBe("Babysitter: Nan");
    expect(recipientSummary(LIST[1]!)).toBe("No babysitter");
    expect(recipientLabel(LIST[0]!)).toBe("nan.pop@example.com, babysitter Nan");
    expect(recipientLabel(LIST[1]!)).toBe("aunty.bec@example.com, no babysitter");
  });

  it("drops the row index from the server's 400 text", () => {
    expect(serverProblem("recipients[2]: email is already on the list")).toBe("Email is already on the list");
    expect(serverProblem("at most 10 recipients")).toBe("At most 10 recipients");
  });
});

describe("lastSendText", () => {
  const today = "2026-10-15";
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();

  it("is null before the first roster email", () => {
    expect(lastSendText(null, today)).toBeNull();
  });

  it("names the date, time and people reached", () => {
    expect(lastSendText({ at: at(2, 18, 3), ok: true, recipients: 2 }, today)).toEqual({
      text: "Last sent Fri 2 Oct, 6:03 pm to 2 people",
      failed: false,
    });
    expect(lastSendText({ at: at(15, 8, 42), ok: true, recipients: 1 }, today)?.text).toBe(
      "Last sent Today, 8:42 am to 1 person",
    );
    expect(lastSendText({ at: at(14, 0, 5), ok: true, recipients: 3 }, today)?.text).toBe(
      "Last sent Yesterday, 12:05 am to 3 people",
    );
  });

  it("adds the year outside this year", () => {
    const last = { at: new Date(2025, 11, 30, 21, 0).getTime(), ok: true, recipients: 2 };
    expect(lastSendText(last, today)?.text).toBe("Last sent Tue 30 Dec 2025, 9:00 pm to 2 people");
  });

  it("says a failed email failed", () => {
    expect(lastSendText({ at: at(2, 18, 3), ok: false, recipients: 1 }, today)).toEqual({
      text: "Last email failed Fri 2 Oct, 6:03 pm. Check the server log.",
      failed: true,
    });
  });
});
