// core/ime.ts — keyboard helpers shared by popup / side panel inputs.
// Chrome fires two keydown events for Enter while a Hangul syllable is composing:
// first with keyCode 229 / isComposing=true, then the real one. Only the second counts.

export interface KeyLike {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export function isComposingEvent(e: KeyLike): boolean {
  return e.isComposing === true || e.keyCode === 229;
}

export function isCommitEnter(e: KeyLike): boolean {
  return e.key === 'Enter' && !isComposingEvent(e);
}

export type EnterVariant = 'plain' | 'window' | 'switch';

/** Enter → plain, Ctrl/⌘+Enter → window, Shift+Enter → switch. Undefined while composing / other keys. */
export function enterVariant(e: KeyLike): EnterVariant | undefined {
  if (!isCommitEnter(e)) return undefined;
  if (e.ctrlKey || e.metaKey) return 'window';
  if (e.shiftKey) return 'switch';
  return 'plain';
}
