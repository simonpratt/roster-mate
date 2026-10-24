import { writeFile } from 'node:fs/promises';
import { renderTemplate, templatePath } from './render.ts';

await writeFile(templatePath, await renderTemplate());
console.log(`wrote ${templatePath}`);
