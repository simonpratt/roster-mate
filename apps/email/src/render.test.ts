import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { renderTemplate, templatePath } from './render.ts';

test('the committed Go template is the rendered RosterEmail', async () => {
  const committed = await readFile(templatePath, 'utf8');
  const rendered = await renderTemplate();
  expect(rendered === committed, 'roster.html.tmpl is stale: run `pnpm --filter ./apps/email render`').toBe(true);
});

test('the template carries every action the Go view fills', async () => {
  const html = await renderTemplate();
  for (const action of ['.Subject', '.Preheader', '.Range', '.Summary', 'range .Weeks', '.Title', 'range .Rows',
    '.Date', '.Code', '.Label', '.ChipBg', '.ChipFg', '.ChipLine', '.LabelFg', '.LabelWeight', '.DateFg', '.RowBg', '.RowLine']) {
    expect(html).toContain(`{{${action}}}`);
  }
  expect(html).toContain('<meta name="color-scheme" content="light"');
});
