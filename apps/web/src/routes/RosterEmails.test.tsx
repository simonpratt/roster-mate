import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipient, Recipients } from "../api";
import { db } from "../db";
import { renderApp, setOnline, stubFetch } from "../test-utils";

// Thursday 15 October 2026, 9 am local time, as in docs/designs/RosterEmails.dc.html.
const NOW = new Date(2026, 9, 15, 9, 0);
const SENT_AT = new Date(2026, 9, 2, 18, 3).getTime();

const SYNCED = { status: 200, body: { rev: 0, dbId: "db", shifts: [] } };
const session = (email?: boolean) => ({
  status: 200,
  body: email === undefined ? { username: "simon" } : { username: "simon", email },
});

const SAMPLE: Recipient[] = [
  { email: "nan.pop@example.com", babysitter: "Nan" },
  { email: "mum@example.com", babysitter: "Mum" },
  { email: "aunty.bec@example.com", babysitter: "" },
];

type Put = (list: Recipient[]) => { status: number; body?: unknown } | Error;

/** The server echoing each PUT's list back, unless put answers otherwise. */
function stubServer(initial: Recipients, put?: Put) {
  let current = initial;
  return stubFetch({
    "/api/session": session(true),
    "/api/sync": SYNCED,
    "/api/recipients": (init) => {
      if (init?.method !== "PUT") return { status: 200, body: current };
      const list = (JSON.parse(String(init.body)) as { recipients: Recipient[] }).recipients;
      const reply = put?.(list);
      if (reply) return reply;
      current = { ...current, recipients: list };
      return { status: 200, body: current };
    },
  });
}

/** The bodies of every PUT /api/recipients made. */
function puts(fetchMock: ReturnType<typeof stubFetch>): unknown[] {
  return fetchMock.mock.calls
    .filter(([path, init]) => path === "/api/recipients" && init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init!.body)));
}

async function openScreen() {
  renderApp("/emails");
  expect(await screen.findByRole("heading", { level: 1, name: "Roster emails" })).toBeInTheDocument();
}

const rowNames = () =>
  within(screen.getByRole("region", { name: "Recipients" }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

const sheet = () => screen.getByRole("dialog");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // The babysitters used so far, as in the design: Mum, Nan and Pop.
  await db.babysitters.bulkPut(
    ["Mum", "Nan", "Pop"].map((name, i) => ({ date: `2026-10-2${i}`, name, confirmed: false, editedAt: 1 })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the ⋯ menu", () => {
  async function menuItems() {
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    return within(screen.getByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent);
  }

  it.each([
    ["false", false],
    ["absent", undefined],
  ])("has no Roster emails item when the session's email is %s", async (_, email) => {
    stubFetch({ "/api/session": session(email), "/api/sync": SYNCED });
    renderApp("/");
    await waitFor(async () => expect((await db.meta.get("emailEnabled"))?.value).toBe(false));
    expect(await menuItems()).toEqual(["Babysitters", "History", "Sign out"]);
  });

  it("shows Roster emails between History and Sign out with email on, and still offline after a reload", async () => {
    stubFetch({ "/api/session": session(true), "/api/sync": SYNCED });
    const { unmount } = renderApp("/");
    await waitFor(async () => expect((await db.meta.get("emailEnabled"))?.value).toBe(true));
    expect(await menuItems()).toEqual(["Babysitters", "History", "Roster emails", "Sign out"]);
    expect(screen.getByRole("menuitem", { name: "Roster emails" })).toHaveAttribute("href", "/emails");
    unmount();

    // Reloaded offline: no session check, and the remembered flag keeps the item.
    setOnline(false);
    const fetchMock = stubFetch({});
    renderApp("/");
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Roster emails" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/session", expect.anything());
  });
});

describe("Roster emails screen", () => {
  it("needs a connection while offline, and loads nothing", async () => {
    setOnline(false);
    const fetchMock = stubFetch({});
    await openScreen();
    expect(screen.getByRole("heading", { level: 2, name: "Roster emails need a connection" })).toBeInTheDocument();
    expect(screen.getByText("Reconnect to your home network to change who gets your roster.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to calendar" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("region", { name: "Recipients" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add recipient" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a 500", { status: 500, body: { error: "internal error" } }],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("needs a connection when loading the recipients meets %s", async (_, reply) => {
    stubFetch({ "/api/session": session(true), "/api/sync": SYNCED, "/api/recipients": reply });
    await openScreen();
    expect(await screen.findByRole("heading", { name: "Roster emails need a connection" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recipients" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add recipient" })).not.toBeInTheDocument();
  });

  it("goes to sign in on a 401", async () => {
    stubFetch({ "/api/session": session(true), "/api/sync": SYNCED, "/api/recipients": { status: 401 } });
    renderApp("/emails");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("goes back to the Calendar and forgets the flag when email has been switched off (404)", async () => {
    await db.meta.put({ key: "emailEnabled", value: true });
    // The session check doesn't answer, so only the 404 changes the flag.
    stubFetch({ "/api/session": new TypeError("Failed to fetch"), "/api/sync": SYNCED, "/api/recipients": { status: 404 } });
    renderApp("/emails");
    expect(await screen.findByRole("button", { name: "Today" })).toBeInTheDocument();
    expect((await db.meta.get("emailEnabled"))?.value).toBe(false);
  });

  it("lists the recipients in order with the last send", async () => {
    stubServer({ recipients: SAMPLE, lastSend: { at: SENT_AT, ok: true, recipients: 2 } });
    await openScreen();
    expect(await screen.findByRole("region", { name: "Recipients" })).toBeInTheDocument();
    expect(rowNames()).toEqual([
      "nan.pop@example.com, babysitter Nan",
      "mum@example.com, babysitter Mum",
      "aunty.bec@example.com, no babysitter",
    ]);
    expect(screen.getByText("Babysitter: Nan")).toBeInTheDocument();
    expect(screen.getByText("No babysitter")).toBeInTheDocument();
    expect(
      screen.getByText("When you import a roster, its shifts are emailed to everyone here. Babysitters and notes are left out."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Last sent Fri 2 Oct, 6:03 pm to 2 people");
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeInTheDocument();
  });

  it("says when the last roster email failed", async () => {
    stubServer({ recipients: SAMPLE, lastSend: { at: SENT_AT, ok: false, recipients: 1 } });
    await openScreen();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Last email failed Fri 2 Oct, 6:03 pm. Check the server log.",
    );
  });

  it("shows the empty state, and no last-send line before the first roster email", async () => {
    stubServer({ recipients: [], lastSend: null });
    await openScreen();
    expect(
      await screen.findByText("No one gets your roster yet. Add an email address to send each new roster to."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recipients" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeInTheDocument();
  });

  it("hides Add recipient at 10 recipients", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ email: `r${i}@example.com`, babysitter: "" }));
    stubServer({ recipients: ten, lastSend: null });
    await openScreen();
    await screen.findByRole("region", { name: "Recipients" });
    expect(rowNames()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "Add recipient" })).not.toBeInTheDocument();
  });

  it("adds a recipient with a new babysitter, and lists it from the server's answer", async () => {
    const fetchMock = stubServer({ recipients: SAMPLE.slice(0, 1), lastSend: null });
    await openScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Add recipient" }));
    await screen.findByRole("dialog");
    expect(within(sheet()).getByRole("heading", { name: "Add recipient" })).toBeInTheDocument();
    expect(within(sheet()).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole("button", { name: "Remove recipient" })).not.toBeInTheDocument();
    expect(within(sheet()).getByText("Who this address belongs to. Their babysitting dates aren’t emailed.")).toBeInTheDocument();

    fireEvent.change(within(sheet()).getByLabelText("Email address"), { target: { value: " Aunty.Bec@Example.com " } });
    fireEvent.click(within(sheet()).getByRole("radio", { name: "Someone else" }));
    fireEvent.change(within(sheet()).getByLabelText("Name"), { target: { value: "Bec" } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(puts(fetchMock)).toEqual([
      {
        recipients: [
          { email: "nan.pop@example.com", babysitter: "Nan" },
          { email: "aunty.bec@example.com", babysitter: "Bec" },
        ],
      },
    ]);
    expect(rowNames()).toEqual(["nan.pop@example.com, babysitter Nan", "aunty.bec@example.com, babysitter Bec"]);
    expect(screen.getByRole("button", { name: "Add recipient" })).toHaveFocus();
  });

  it("edits a recipient's babysitter, and returns focus to its row", async () => {
    const fetchMock = stubServer({ recipients: SAMPLE, lastSend: null });
    await openScreen();
    fireEvent.click(await screen.findByRole("button", { name: "aunty.bec@example.com, no babysitter" }));
    await screen.findByRole("dialog");
    expect(within(sheet()).getByRole("heading", { name: "Edit recipient" })).toBeInTheDocument();
    expect(within(sheet()).getByLabelText("Email address")).toHaveValue("aunty.bec@example.com");
    expect(within(sheet()).getByRole("radio", { name: "None" })).toBeChecked();

    fireEvent.click(within(sheet()).getByRole("radio", { name: "Pop" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(puts(fetchMock)).toEqual([
      { recipients: [SAMPLE[0], SAMPLE[1], { email: "aunty.bec@example.com", babysitter: "Pop" }] },
    ]);
    const row = screen.getByRole("button", { name: "aunty.bec@example.com, babysitter Pop" });
    expect(row).toHaveFocus();
  });

  it("removes a recipient at once", async () => {
    const fetchMock = stubServer({ recipients: SAMPLE, lastSend: null });
    await openScreen();
    fireEvent.click(await screen.findByRole("button", { name: "mum@example.com, babysitter Mum" }));
    await screen.findByRole("dialog");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Remove recipient" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(puts(fetchMock)).toEqual([{ recipients: [SAMPLE[0], SAMPLE[2]] }]);
    expect(rowNames()).toEqual(["nan.pop@example.com, babysitter Nan", "aunty.bec@example.com, no babysitter"]);
    expect(screen.getByRole("button", { name: "Add recipient" })).toHaveFocus();
  });

  it.each([
    ["an invalid address", "nan@example", "Enter an email address like nan@example.com."],
    ["a duplicate address, ignoring case", "MUM@example.com", "That address is already on the list."],
  ])("shows its message for %s without a request", async (_, email, message) => {
    const fetchMock = stubServer({ recipients: SAMPLE, lastSend: null });
    await openScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Add recipient" }));
    await screen.findByRole("dialog");
    const input = within(sheet()).getByLabelText("Email address");
    fireEvent.change(input, { target: { value: email } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }));

    expect(await within(sheet()).findByText(message)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(message);
    expect(puts(fetchMock)).toEqual([]);
  });

  it("keeps the sheet open with the error when the save fails", async () => {
    const fetchMock = stubServer({ recipients: SAMPLE, lastSend: null }, () => new TypeError("Failed to fetch"));
    await openScreen();
    fireEvent.click(await screen.findByRole("button", { name: "mum@example.com, babysitter Mum" }));
    await screen.findByRole("dialog");
    fireEvent.click(within(sheet()).getByRole("radio", { name: "None" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }));

    expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
      "Couldn’t save. Check your connection and try again.",
    );
    expect(puts(fetchMock)).toHaveLength(1);
    expect(within(sheet()).getByRole("button", { name: "Save" })).toBeEnabled();
    // The list is as the server last answered.
    expect(rowNames()).toContain("mum@example.com, babysitter Mum");
  });

  it("shows the server's 400 text under the field", async () => {
    stubServer({ recipients: SAMPLE, lastSend: null }, () => ({
      status: 400,
      body: { error: "recipients[3]: email must be an address like nan@example.com" },
    }));
    await openScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Add recipient" }));
    await screen.findByRole("dialog");
    fireEvent.change(within(sheet()).getByLabelText("Email address"), { target: { value: "odd@example.com" } });
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }));
    expect(await within(sheet()).findByText("Email must be an address like nan@example.com")).toBeInTheDocument();
    expect(within(sheet()).queryByRole("alert")).not.toBeInTheDocument();
  });
});
