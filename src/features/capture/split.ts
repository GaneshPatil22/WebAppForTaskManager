/**
 * How a dump becomes captures. Brain makes one item per capture, so a list
 * pasted as one capture would become one item. The user chooses: send the
 * text as it is, or one capture per line. This splits only on the line
 * breaks the user typed; it never interprets the text.
 */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim())
    .filter((l) => l.length > 0);
}

/** One capture per line only makes sense with more than one line. */
export const canSplit = (text: string) => splitLines(text).length > 1;
