/**
 * The point of the whole exercise: ONE matcher, ONE folding rule, two kinds of
 * work — a Readstein book section and a Streamstein video transcript — in a
 * single dial.
 *
 * The book-side section below is shaped exactly like Readstein's
 * `SearchIndexSection` (`{idx, label, text}`, services/librarySearchIndex.ts:26),
 * including its extra `startMs`/`cueIdx` fields absent. The video-side section is
 * produced by the cue chunker. Neither side knows what kind of work it belongs to.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { chunkCues, parseTranscript, type SearchIndexSection } from '../src/vtt.ts';
import { searchWorks, type SearchableWork, type SpiralSearchEvent } from '../src/search.ts';

const BOOK_ID = 'b1f4c0de9d3a7e2f';

/** Shaped like a Readstein book's search.db sections. */
const bookSections: SearchIndexSection[] = [
  {
    idx: 0,
    label: 'Chapter II. The Ring',
    text: 'The dial is concentric: the hub holds the query, the first ring is the years the current results occupy. A composite manuscript with three dated parts occupies three places on the ring. The hotel café on the corner served as the reading room.',
    startMs: 0,
    cueIdx: 0,
  },
  {
    idx: 1,
    label: 'Chapter III. The Panel',
    text: 'The panel to the right shows the passages that actually matched. Every ring is scrollable, so the whole collection can be walked like a combination lock without typing anything.',
    startMs: 0,
    cueIdx: 0,
  },
];

const videoSections = chunkCues(
  parseTranscript(readFileSync(new URL('../fixtures/sample.vtt', import.meta.url), 'utf8')),
  undefined,
  { maxCues: 3 },
);

const works: SearchableWork[] = [
  { workId: BOOK_ID, kind: 'book', sections: bookSections },
  { workId: 'd41d8cd98f00b204', kind: 'video', sections: videoSections },
];

const collect = async (query: string, mode: 'contains' | 'whole-words' | 'fuzzy' = 'contains') => {
  const events: SpiralSearchEvent[] = [];
  for await (const e of searchWorks(works, { query, mode })) events.push(e);
  return events;
};

test('one query returns both a book and a video, with their own locator kinds', async () => {
  const events = await collect('ring');
  const matches = events.filter((e) => e.kind === 'match') as Array<{
    workId: string;
    label: string;
    match: { locator: { tMs: number; charStart: number; charEnd: number }; excerpt: { match: string } };
  }>;
  const ofWork = (id: string) => matches.filter((m) => m.workId === id);

  assert.equal(ofWork(BOOK_ID).length, 3, 'the book says "ring" twice in one chapter and once in the next');
  assert.deepEqual(
    ofWork(BOOK_ID).map((m) => m.label),
    ['Chapter II. The Ring', 'Chapter II. The Ring', 'Chapter III. The Panel'],
    'book results keep their own section labels',
  );
  for (const m of ofWork(BOOK_ID)) {
    assert.equal(m.match.excerpt.match, 'ring');
  }

  const video = ofWork('d41d8cd98f00b204');
  assert.equal(video.length, 1, 'the video matches once');
  assert.equal(video[0]!.match.locator.tMs, 15000, 'the video result seeks to the cue that says it (15 s)');
  assert.equal(typeof video[0]!.label, 'string');
});

test('the same folding rule applies to both sides', async () => {
  const events = await collect('cafe');
  const matches = events.filter((e) => e.kind === 'match') as Array<{
    workId: string;
    match: { excerpt: { match: string } };
  }>;
  assert.equal(matches.length, 2, 'both the book café and the transcript café fold-match plain ASCII "cafe"');
  assert.deepEqual(
    new Set(matches.map((m) => m.workId)),
    new Set([BOOK_ID, 'd41d8cd98f00b204']),
    'one hit from each side — a book and a video — from one query',
  );
  for (const m of matches) {
    assert.equal(m.match.excerpt.match.toLowerCase(), 'café', 'the excerpt is the original text, with its accent');
  }
});

test('whole-word semantics are identical across both kinds of work', async () => {
  const contains = await collect('rin', 'contains');
  const whole = await collect('rin', 'whole-words');
  const count = (events: SpiralSearchEvent[]) => events.filter((e) => e.kind === 'match').length;
  assert.ok(count(contains) >= 1, '"rin" appears inside "ring"');
  assert.equal(count(whole), 0, '"rin" is not a whole word anywhere');
});

test('the dial sees the same event stream regardless of work kind', async () => {
  const events = await collect('scrollable');
  const kinds = events.map((e) => e.kind);
  assert.equal(kinds[0], 'work', 'a work event opens each work');
  assert.equal(kinds[kinds.length - 1], 'done');
  assert.deepEqual(
    events.filter((e) => e.kind === 'work').map((e) => (e as { workId: string }).workId),
    [BOOK_ID, 'd41d8cd98f00b204'],
    'works are streamed in the order given, book and video alike',
  );
  assert.equal(events.filter((e) => e.kind === 'progress').length, 2, 'progress per work, so the dial can fill live');
  const match = events.find((e) => e.kind === 'match') as { workId: string; label: string };
  assert.equal(match.workId, BOOK_ID);
  assert.equal(match.label, 'Chapter III. The Panel');
});
