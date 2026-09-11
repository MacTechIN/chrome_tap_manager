import { describe, expect, it } from 'vitest';
import { autoName, nameFromTabs, nextUnnamed, siteName } from '../../src/core/autoName';

describe('siteName', () => {
  it('returns host without www for http(s)', () => {
    expect(siteName('https://www.github.com/MacTechIN/x')).toBe('github.com');
    expect(siteName('http://localhost:3000/a')).toBe('localhost');
  });

  it('returns scheme://host for other schemes and undefined for about:/empty/invalid', () => {
    expect(siteName('chrome://extensions/')).toBe('chrome://extensions');
    expect(siteName('file:///C:/Users/x/doc.pdf')).toBe('file://C:');
    expect(siteName('about:blank')).toBeUndefined();
    expect(siteName('')).toBeUndefined();
    expect(siteName('not a url')).toBeUndefined();
  });
});

describe('nameFromTabs', () => {
  it('single tab → its site; falls back to title when no site', () => {
    expect(nameFromTabs([{ url: 'https://www.notion.so/x', title: 'Notes' }])).toBe('notion.so');
    expect(nameFromTabs([{ url: 'about:blank', title: '  새  탭 ' }])).toBe('새 탭');
    expect(nameFromTabs([{ url: 'about:blank', title: '' }])).toBeUndefined();
  });

  it('several tabs → most common host; ties keep first seen', () => {
    expect(
      nameFromTabs([
        { url: 'https://a.com/1', title: '' },
        { url: 'https://b.com/1', title: '' },
        { url: 'https://b.com/2', title: '' },
      ]),
    ).toBe('b.com');
    expect(
      nameFromTabs([
        { url: 'https://a.com/1', title: '' },
        { url: 'https://b.com/1', title: '' },
      ]),
    ).toBe('a.com');
  });

  it('several tabs without hosts → first non-empty title; none → undefined', () => {
    expect(
      nameFromTabs([
        { url: 'about:blank', title: '' },
        { url: 'about:blank', title: 'Second' },
      ]),
    ).toBe('Second');
    expect(nameFromTabs([])).toBeUndefined();
  });

  it('truncates to 50 chars', () => {
    const long = 'x'.repeat(80);
    const name = nameFromTabs([{ url: 'about:blank', title: long }])!;
    expect(name.length).toBe(50);
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('nextUnnamed / autoName', () => {
  it('picks the smallest free "새 주제 N" (case/space-insensitive)', () => {
    expect(nextUnnamed([])).toBe('새 주제 1');
    expect(nextUnnamed(['새 주제 1', ' 새 주제 2 ', 'Dev'])).toBe('새 주제 3');
    expect(nextUnnamed(['새 주제 2'])).toBe('새 주제 1');
  });

  it('autoName uses tabs when possible, else a fresh placeholder', () => {
    expect(autoName([{ url: 'https://x.dev/', title: '' }], ['새 주제 1'])).toBe('x.dev');
    expect(autoName([], ['새 주제 1'])).toBe('새 주제 2');
  });
});
