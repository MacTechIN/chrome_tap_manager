import { describe, expect, it } from 'vitest';
import { fingerprint, fnv1a64, normalizeTitle, normalizeUrl } from '../../src/core/fingerprint';

describe('normalizeUrl', () => {
  it('lower-cases scheme/host, drops hash, default port and trailing slash', () => {
    expect(normalizeUrl('HTTPS://GitHub.com:443/MacTechIN/chrome_tap_manager/#readme')).toBe(
      'https://github.com/MacTechIN/chrome_tap_manager',
    );
  });

  it('keeps the query string and non-default port', () => {
    expect(normalizeUrl('http://localhost:3000/a/?x=1&y=2')).toBe(
      'http://localhost:3000/a?x=1&y=2',
    );
  });

  it('keeps root path slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('handles chrome:// scheme like any URL (root slash kept)', () => {
    expect(normalizeUrl('  chrome://extensions/  ')).toBe('chrome://extensions/');
    expect(normalizeUrl('chrome://settings/privacy/')).toBe('chrome://settings/privacy');
  });

  it('returns trimmed input when not a valid URL', () => {
    expect(normalizeUrl('  not a url ')).toBe('not a url');
  });

  it('applies NFC normalization', () => {
    const nfd = 'https://example.com/한글'.normalize('NFD');
    expect(normalizeUrl(nfd)).toBe(normalizeUrl('https://example.com/한글'));
  });
});

describe('normalizeTitle', () => {
  it('trims, collapses whitespace and NFC-normalizes', () => {
    expect(normalizeTitle('  리액트   Hooks\n가이드 ')).toBe('리액트 Hooks 가이드');
    expect(normalizeTitle('한글'.normalize('NFD'))).toBe('한글');
  });
});

describe('fingerprint', () => {
  it('is deterministic and 16 hex chars', () => {
    const a = fingerprint('https://github.com/', 'GitHub');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint('https://github.com/', 'GitHub')).toBe(a);
  });

  it('is equal for inputs that normalize to the same value', () => {
    expect(fingerprint('HTTPS://GitHub.com/#top', '  GitHub ')).toBe(
      fingerprint('https://github.com/', 'GitHub'),
    );
  });

  it('differs when url or title differ', () => {
    const base = fingerprint('https://github.com/', 'GitHub');
    expect(fingerprint('https://github.com/a', 'GitHub')).not.toBe(base);
    expect(fingerprint('https://github.com/', 'GitHub · Home')).not.toBe(base);
  });

  it('fnv1a64 matches known vector', () => {
    // FNV-1a 64-bit of empty string is the offset basis.
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
  });
});
