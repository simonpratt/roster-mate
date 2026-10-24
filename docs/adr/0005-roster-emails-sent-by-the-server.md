# Roster emails are sent by the server, to recipients only the server keeps

The user wants each new roster emailed to family who mind the children, so they no longer have to
pass it on by hand (SIM-51). The server sends a roster email through Resend when a sync applies shift
changes whose source is `import`, waiting briefly so an import that took several sync batches sends
one email. It reads the shifts from its own database, so the email shows what was saved, after
last-write-wins, and sending survives the phone losing its connection after Save: the outbox
retries the edits, and the email follows them.

Recipients live only on the server, in a table edited through `GET`/`PUT /api/recipients`. The
Roster emails screen calls that API directly and needs a connection, like Import. This is the second
exception, after extraction, to "the UI reads and writes only IndexedDB" (ADR 0001): only the server
uses the list, sending needs the server anyway, and a synced kind would add a fourth outbox for a
list edited a few times a year.

The email's HTML is written with React Email and rendered at build time, not run time: a script in
its own workspace package renders the component into a Go `html/template`, which is committed and
embedded in the binary. The server fills the template; no JavaScript runs on the server, and the
image gains no Node dependencies.

## Considered Options

- **Recipients as environment variables**: no screen and no table, but changing them means
  redeploying, and the link to a babysitter becomes a naming convention in a string.
- **Recipients as a synced kind** (like babysitters, ADR 0003): editable offline, but nothing is
  emailed offline, and it extends the sync protocol and Dexie schema.
- **The phone asks the server to send after Save**: simple, but the request is lost if the
  connection drops between Save and the edits syncing, and the email would be built from what the
  phone held rather than what the server kept.
- **Rendering React Email at run time**: needs Node beside the Go binary, or in the phone's bundle
  with the HTML posted to the server.

## Consequences

- Email is off unless `RESEND_API_KEY` is set: no menu item, the recipients API answers 404, and
  nothing is sent.
- A roster email waiting out its delay is lost if the server stops first. The screen's last-send
  line shows whether the latest one went out.
- Changing the email's markup means re-running the render script and committing the template; a
  test fails while the committed template is stale.
- Each recipient's babysitter is stored but not yet used. A later change may add each babysitter's
  own dates to their email.
