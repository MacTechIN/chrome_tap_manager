import { describe, expect, it } from 'vitest';
import { enterVariant, isCommitEnter, isComposingEvent } from '../../src/core/ime';

describe('IME guards', () => {
  it('ignores Enter while composing (isComposing or keyCode 229)', () => {
    expect(isComposingEvent({ key: 'Enter', isComposing: true })).toBe(true);
    expect(isComposingEvent({ key: 'Enter', keyCode: 229 })).toBe(true);
    expect(isCommitEnter({ key: 'Enter', isComposing: true })).toBe(false);
    expect(isCommitEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
    expect(isCommitEnter({ key: 'Enter', keyCode: 13, isComposing: false })).toBe(true);
  });

  it('maps modifiers to variants', () => {
    expect(enterVariant({ key: 'Enter' })).toBe('plain');
    expect(enterVariant({ key: 'Enter', ctrlKey: true })).toBe('window');
    expect(enterVariant({ key: 'Enter', metaKey: true })).toBe('window');
    expect(enterVariant({ key: 'Enter', shiftKey: true })).toBe('switch');
    expect(enterVariant({ key: 'Enter', keyCode: 229 })).toBeUndefined();
    expect(enterVariant({ key: 'a' })).toBeUndefined();
  });
});
