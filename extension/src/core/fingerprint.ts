// core/fingerprint.ts — stable tab identity across Chrome restarts.
// Synchronous 64-bit FNV-1a over normalized url + '\n' + normalized title.
// (Plan E02 said sha1; FNV-1a was chosen so reducers in E03 can stay synchronous.
//  Collision risk at ~10k tabs is negligible for identity matching.)

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

export function normalizeUrl(raw: string): string {
  const input = raw.normalize('NFC').trim();
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  u.hash = '';
  if (DEFAULT_PORTS[u.protocol] === u.port) u.port = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  // URL already lower-cases scheme and host.
  return u.toString();
}

export function normalizeTitle(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function fnv1a64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h = FNV_OFFSET;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

export function fingerprint(url: string, title: string): string {
  return fnv1a64(`${normalizeUrl(url)}\n${normalizeTitle(title)}`);
}
