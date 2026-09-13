// scripts/sync-static.mjs — copy the production build into .output/chrome-mv3-dev.
//
// Why: an unpacked extension's ID (and therefore its chrome.storage data) is derived
// from its folder path. Chrome was loaded from `.output/chrome-mv3-dev` (the WXT dev
// output). When the dev server is not running (or must not run — low memory), serving
// the static production build from that SAME folder keeps the ID and the data while
// removing the localhost:3000 dependency. Reload the extension in chrome://extensions
// after running this.
//
// Note: fs.cpSync({ recursive: true }) crashes Node 24.14 on this Windows setup
// (non-ASCII user path), so the copy is done by hand.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve('.output/chrome-mv3');
const dst = resolve('.output/chrome-mv3-dev');

if (!existsSync(src)) {
  console.error(`missing ${src} — run "pnpm build" first`);
  process.exit(1);
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  let files = 0;
  for (const name of readdirSync(from)) {
    const a = join(from, name);
    const b = join(to, name);
    if (statSync(a).isDirectory()) files += copyDir(a, b);
    else {
      copyFileSync(a, b);
      files += 1;
    }
  }
  return files;
}

rmSync(dst, { recursive: true, force: true });
const n = copyDir(src, dst);
console.log(`synced ${n} files: ${src} → ${dst}`);
console.log('Now reload the extension in chrome://extensions (↻).');
