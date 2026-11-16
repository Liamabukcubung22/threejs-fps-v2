// DUSTFALL — make.fun threejs-fps-02 entry program.
//
// Copies game/ and screenshots/ from this repository into the output
// directory and writes /output/dossier.json with the kit's buildDossier
// library (vendor/makefun-threejs.ts, the kit's copy, unchanged).
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.
// Node 22, standard library only; runs twice and writes identical bytes.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(resolve(repoRoot, 'game'), resolve(outDir, 'game'), { recursive: true });
cpSync(resolve(repoRoot, 'screenshots'), resolve(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(repoRoot, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
});
writeFileSync(resolve(outDir, 'dossier.json'), dossier);
console.log(`wrote ${outDir}/dossier.json (${dossier.length} bytes)`);
