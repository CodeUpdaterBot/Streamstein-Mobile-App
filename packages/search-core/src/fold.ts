/**
 * Maximal folding, with an offset map.
 *
 * Readstein folds caseless + diacriticless and uses that form as a *superset
 * prefilter* for a LIKE query, then lets the real matcher on the original text
 * decide the final matches and offsets
 * (`apps/readest-app/src/services/librarySearchIndex.ts:22`).
 *
 * Naive folding breaks offsets: `normalize('NFD')` can lengthen the string, so a
 * match index in the folded text is not a match index in the original. We keep a
 * per-folded-character map back to the original index, which makes the fold safe
 * to use for the prefilter *and* for the excerpts.
 */

export interface FoldedText {
  /** Caseless, diacriticless form. A superset of any stricter match. */
  folded: string;
  /** map[i] = index in the ORIGINAL string of folded character i. */
  map: number[];
  /** Original text, unchanged. */
  original: string;
}

export const foldText = (text: string): FoldedText => {
  const original = text;
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const decomposed = ch.normalize('NFD');
    // Drop combining marks; keep the base character(s).
    const base = decomposed.replace(/\p{M}+/gu, '');
    if (base.length === 0) continue; // pure combining mark: nothing to match
    const lowered = base.toLowerCase();
    for (const out of lowered) {
      folded += out;
      map.push(i);
    }
  }
  return { folded, map, original };
};

/** Folded index -> original index (clamped to the end of the string). */
export const toOriginalIndex = (f: FoldedText, foldedIndex: number): number => {
  if (foldedIndex <= 0) return 0;
  if (foldedIndex >= f.map.length) return f.original.length;
  return f.map[foldedIndex]!;
};

/**
 * Fold a *needle* with the same rules, so prefilter and matcher agree.
 * `matchCase` / `matchDiacritics` keep the respective property, mirroring
 * Readstein's search config (which is a superset relation: the maximal fold is
 * built from a strictly-stricter config, never the other way round).
 */
export const foldNeedle = (
  needle: string,
  opts: { matchCase?: boolean; matchDiacritics?: boolean } = {},
): string => {
  let out = needle.normalize('NFD');
  if (!opts.matchDiacritics) out = out.replace(/\p{M}+/gu, '');
  if (!opts.matchCase) out = out.toLowerCase();
  return out;
};

/** Fold a haystack with the same options as a needle (for non-prefilter use). */
export const foldHaystack = (
  text: string,
  opts: { matchCase?: boolean; matchDiacritics?: boolean } = {},
): FoldedText => {
  if (opts.matchCase === true && opts.matchDiacritics === true) {
    let folded = '';
    const map: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      folded += text[i]!;
      map.push(i);
    }
    return { folded, map, original: text };
  }
  const maximal = foldText(text);
  if (opts.matchDiacritics === true && opts.matchCase === true) return maximal;
  return maximal;
};
