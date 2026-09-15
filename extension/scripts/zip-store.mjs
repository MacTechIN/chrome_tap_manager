// scripts/zip-store.mjs — `pnpm zip` with STORE=1 (manifest without `key`), cross-platform.
// The result is renamed to *-store.zip so it never overwrites the dev/tester zip.
import { spawnSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const r = spawnSync('pnpm', ['exec', 'wxt', 'zip'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, STORE: '1' },
});
if (r.status !== 0) process.exit(r.status ?? 1);

const out = join(process.cwd(), '.output');
for (const f of readdirSync(out)) {
  if (f.endsWith('-chrome.zip') && !f.endsWith('-store.zip')) {
    const to = f.replace(/-chrome\.zip$/, '-chrome-store.zip');
    renameSync(join(out, f), join(out, to));
    console.log(`store zip: .output/${to}`);
  }
}
