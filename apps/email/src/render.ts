import { render } from '@react-email/render';
import { createElement } from 'react';
import { fileURLToPath } from 'node:url';
import { RosterEmail } from './RosterEmail.tsx';

/** Where the rendered template is committed, embedded by apps/server/internal/mail. */
export const templatePath = fileURLToPath(
  new URL('../../server/internal/mail/templates/roster.html.tmpl', import.meta.url),
);

/** The roster email as a Go html/template: its markup, with the template actions as text. */
export async function renderTemplate(): Promise<string> {
  const html = await render(createElement(RosterEmail), { pretty: false });
  return html + '\n';
}
