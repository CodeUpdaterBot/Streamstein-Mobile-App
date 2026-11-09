/**
 * The matcher and the streaming search.
 *
 * Deliberately independent of what it is searching: a "work" is just an id plus a
 * list of sections. A Readstein book (sections from `search.db`) and a Streamstein
 * video (sections from cue chunking) go through the identical code path — that is
 * the whole cross-app requirement, expressed as code rather than as a promise.
 */

import { foldHaystack, foldNeedle, toOriginalIndex, type FoldedText } from './fold.ts';
import type { SearchIndexSection } from './vtt.ts';

export type SearchMode = 'contains' | 'whole-words' | 'fuzzy';
export type SearchTarget = 'works' | 'transcripts' | 'books' | 'text';

export interface SearchConfig {
  query: string;
  mode?: SearchMode;
  matchCase?: boolean;
  matchDiacritics?: boolean;
  target?: SearchTarget;
  /** Characters of context either side of the match. */
  contextChars?: number;
}

export interface SearchExcerpt {
  pre: string;
  match: string;
  post: string;
}

export interface SearchLocator {
  sectionIdx: number;
  /** Index of the cue that contains the match (video side). */
  cueIdx: number;
  /**
   * Seek target in milliseconds: the START of the cue that speaks the match.
   *
   * Deliberately not interpolated into the middle of the cue — a proportional
   * guess would look precise without being right. The cue is the honest unit:
   * for a book the analogue is "the section that contains it, plus a CFI".
   */
  tMs: number;
  /** Offsets of the match inside the section text. */
  charStart: number;
  charEnd: number;
  /** Offsets of the match inside the containing cue's text, when cue spans exist. */
  cueCharStart?: number;
  cueCharEnd?: number;
}

export interface SearchMatch {
  locator: SearchLocator;
  excerpt: SearchExcerpt;
}

export interface SearchableWork {
  workId: string;
  /** `hash` of a MediaItem, or a Book hash — same identity scheme on both sides. */
  kind: 'video' | 'book';
  sections: SearchIndexSection[];
}

export type SpiralSearchEvent =
  | { kind: 'work'; workId: string; totalSections: number }
  | { kind: 'match'; workId: string; sectionIdx: number; label: string; match: SearchMatch }
  | { kind: 'progress'; workId: string; scannedSections: number; totalSections: number }
  | { kind: 'done'; works: number; matches: number }
  | { kind: 'error'; workId: string; message: string };

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** Whole-word test in the ORIGINAL text, at real (unfolded) offsets. */
const isWholeWord = (text: string, start: number, end: number): boolean =>
  !isWordChar(text[start - 1]) && !isWordChar(text[end]);

const levenshteinWithin = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, cur[j]!);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
};

interface RawHit {
  start: number;
  end: number;
  matched: string;
}

/** Exact / whole-word / diacritic-aware search: prefilter in folded space, verify in original. */
const searchContains = (
  f: FoldedText,
  needle: string,
  opts: SearchConfig,
  wholeWords: boolean,
): RawHit[] => {
  const foldedNeedle = foldNeedle(needle, opts);
  if (foldedNeedle.length === 0) return [];
  const hits: RawHit[] = [];
  let from = 0;
  for (;;) {
    const at = f.folded.indexOf(foldedNeedle, from);
    if (at === -1) break;
    const start = toOriginalIndex(f, at);
    const end = toOriginalIndex(f, at + foldedNeedle.length);
    const matched = f.original.slice(start, end);
    const verify = opts.matchCase || opts.matchDiacritics
      ? matched.normalize('NFD')
      : matched.normalize('NFD').replace(/\p{M}+/gu, '');
    const ok = opts.matchCase
      ? verify === (opts.matchDiacritics ? needle : needle.normalize('NFD'))
      : verify.toLowerCase() ===
        (opts.matchDiacritics ? needle.normalize('NFD') : needle).toLowerCase();
    if (ok && (!wholeWords || isWholeWord(f.original, start, end))) {
      hits.push({ start, end, matched });
    }
    from = at + Math.max(1, foldedNeedle.length);
  }
  return hits;
};

/** Fuzzy: token-window edit distance, bounded — a prefilter-quality match, not a typo engine. */
const searchFuzzy = (text: string, needle: string): RawHit[] => {
  const tokens = [...text.matchAll(/[\p{L}\p{N}_']+/gu)];
  const words = needle.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: RawHit[] = [];
  const needleChars = words.join('').length;
  const maxDistance = Math.max(1, Math.floor(needleChars / 4));
  for (let i = 0; i + words.length <= tokens.length; i += 1) {
    const window = tokens.slice(i, i + words.length).map((t) => t[0]).join(' ');
    const distance = levenshteinWithin(window.toLowerCase(), needle.toLowerCase(), maxDistance);
    if (distance <= maxDistance) {
      const start = tokens[i]!.index!;
      const last = tokens[i + words.length - 1]!;
      hits.push({ start, end: last.index! + last[0].length, matched: text.slice(start, last.index! + last[0].length) });
    }
  }
  return hits;
};

const makeExcerpt = (text: string, hit: RawHit, contextChars: number): SearchExcerpt => {
  const pre = text.slice(Math.max(0, hit.start - contextChars), hit.start);
  const post = text.slice(hit.end, Math.min(text.length, hit.end + contextChars));
  return { pre, match: hit.matched, post };
};

/**
 * Resolve a match offset inside a section to the cue that speaks it, so the
 * player can seek to the moment the passage is actually said. Falls back to the
 * section's first cue when the section carries no cue spans (a book section, or
 * an index written before cue spans existed).
 */
const resolveCue = (
  section: SearchIndexSection,
  charStart: number,
): { cueIdx: number; tMs: number; cueCharStart: number } | null => {
  const spans = section.cueSpans;
  if (!spans || spans.length === 0) return null;
  for (const span of spans) {
    if (charStart >= span.textStart && charStart < span.textEnd) {
      return { cueIdx: span.cueIdx, tMs: span.startMs, cueCharStart: charStart - span.textStart };
    }
  }
  const last = spans[spans.length - 1]!;
  return { cueIdx: last.cueIdx, tMs: last.startMs, cueCharStart: Math.max(0, charStart - last.textStart) };
};

const makeLocator = (section: SearchIndexSection, hit: RawHit): SearchLocator => {
  const cue = resolveCue(section, hit.start);
  const locator: SearchLocator = {
    sectionIdx: section.idx,
    cueIdx: cue?.cueIdx ?? section.cueIdx,
    tMs: cue?.tMs ?? section.startMs,
    charStart: hit.start,
    charEnd: hit.end,
  };
  if (cue) {
    locator.cueCharStart = cue.cueCharStart;
    locator.cueCharEnd = cue.cueCharStart + (hit.end - hit.start);
  }
  return locator;
};

/**
 * Search one work's sections; returns matches in section order, each with a
 * locator that can (later) be resolved to a seek target.
 */
export const searchWorkSections = (
  sections: SearchIndexSection[],
  config: SearchConfig,
): Array<{ sectionIdx: number; label: string; match: SearchMatch }> => {
  const query = config.query ?? '';
  if (query.trim().length === 0) return [];
  const mode: SearchMode = config.mode ?? 'contains';
  const contextChars = config.contextChars ?? 60;
  const out: Array<{ sectionIdx: number; label: string; match: SearchMatch }> = [];

  for (const section of sections) {
    const folded = foldHaystack(section.text, config);
    const hits =
      mode === 'fuzzy'
        ? searchFuzzy(section.text, query)
        : searchContains(folded, query, config, mode === 'whole-words');

    for (const hit of hits) {
      out.push({
        sectionIdx: section.idx,
        label: section.label,
        match: {
          locator: makeLocator(section, hit),
          excerpt: makeExcerpt(section.text, hit, contextChars),
        },
      });
    }
  }
  return out;
};

/**
 * Streaming search over many works — an async generator, so a dial can fill out
 * live instead of waiting for a whole-library scan (Readstein's
 * `searchLibraryBooks` is an async generator for the same reason).
 */
export async function* searchWorks(
  works: AsyncIterable<SearchableWork> | Iterable<SearchableWork>,
  config: SearchConfig,
): AsyncGenerator<SpiralSearchEvent> {
  let workCount = 0;
  let matchCount = 0;
  for await (const work of works as AsyncIterable<SearchableWork>) {
    workCount += 1;
    yield { kind: 'work', workId: work.workId, totalSections: work.sections.length };
    try {
      const found = searchWorkSections(work.sections, config);
      let scanned = 0;
      for (const f of found) {
        matchCount += 1;
        yield { kind: 'match', workId: work.workId, sectionIdx: f.sectionIdx, label: f.label, match: f.match };
      }
      // Report progress per work so the dial can show the scan advancing.
      scanned = work.sections.length;
      yield { kind: 'progress', workId: work.workId, scannedSections: scanned, totalSections: work.sections.length };
    } catch (err) {
      yield { kind: 'error', workId: work.workId, message: (err as Error).message };
    }
  }
  yield { kind: 'done', works: workCount, matches: matchCount };
}
