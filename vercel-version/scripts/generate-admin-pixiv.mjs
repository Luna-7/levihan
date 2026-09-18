import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(projectRoot, 'src/data/initialData.ts'), 'utf8');
const match = source.match(/export const PIXIV_ARTISTS_DATA:[^\n]*= (\[[\s\S]*?\]);/);
if (!match) throw new Error('Could not find PIXIV_ARTISTS_DATA');
const artists = JSON.parse(match[1]);
const entries = artists.filter((artist) => artist.url).map(({ name, url }) => ({ name, url }));
await writeFile(resolve(projectRoot, 'public/admin/pixiv-artists.js'),
  '/* Generated from src/data/initialData.ts PIXIV_ARTISTS_DATA. */\n' +
  'window.LEVIHAN_PIXIV_ARTISTS = ' + JSON.stringify(entries) + ';\n');
