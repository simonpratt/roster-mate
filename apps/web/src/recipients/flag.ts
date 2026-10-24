// Whether the server has roster emails set up (`/api/session`'s `email`), kept in Dexie `meta` so
// the ⋯ menu shows Roster emails correctly offline (docs/ux-spec.md §5.1).
import { useLiveQuery } from "dexie-react-hooks";
import { getSession, type Session } from "../api";
import { db } from "../db";

/** Records whether roster emails are on. */
export async function setEmailEnabled(on: boolean): Promise<void> {
  await db.meta.put({ key: "emailEnabled", value: on });
}

/** Forgets the flag, as on sign-out; the next session check writes it again. */
export async function clearEmailEnabled(): Promise<void> {
  await db.meta.delete("emailEnabled");
}

/** Asks the server for the session and records its email flag. Throws as getSession does. */
export async function checkSession(): Promise<Session> {
  const session = await getSession();
  await setEmailEnabled(session.email);
  return session;
}

/** Whether the server last said roster emails are on; false until it has said so. */
export function useEmailEnabled(): boolean {
  return useLiveQuery(async () => (await db.meta.get("emailEnabled"))?.value === true, [], false);
}
