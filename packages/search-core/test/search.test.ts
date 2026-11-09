import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { chunkCues, parseTranscript, type SearchIndexSection } from '../src/vtt.ts';
import { searchWorkSections, searchWorks, type SpiralSearchEvent } from '../src/search.ts';

const vtt = readFileSync(new URL('../fixtures/sample.vtt', import.meta.url), 'utf8');

const transcriptSections = (): SearchIndexSection[] =>
  chunkCues(parseTranscript(vtt), undefined, { maxCues: 2 });

test('contains: a transcript hit carries the seek time of its section', () => {
  const sections = transcriptSections();
  const hits = searchWorkSections(sections, { query: 'spiral search' });
  assert.equal(hits.length, 1);

  const hit = hits[0]!;
  assert.equal(hit.match.excerpt.match, 'spiral search', 'excerpt shows the original text, not the folded form');
  assert.equal(hit.match.locator.tMs, 0, 'section 0 starts at 0 ms');
  assert.equal(hit.match.locator.sectionIdx, 0);
  assert.equal(hit.match.locator.cueIdx, 0);
  assert.ok(hit.match.excerpt.pre.includes("tonight we're looking at the"));
});

test('the locator seeks into the RIGHT cue, not just the first one in the section', () => {
  const sections = transcriptSections();
  const hits = searchWorkSections(sections, { query: 'timestamp, not a page' });
  assert.equal(hits.length, 1);
  const locator = hits[0]!.match.locator;
  const section = sections[locator.sectionIdx]!;

  assert.equal(section.startMs, 21400, 'the section itself starts earlier — that is why section-start seeking was wrong');
  assert.equal(locator.cueIdx, 5, 'the match lives in cue 5');
  assert.equal(locator.tMs, 28000, 'the seek target is the cue that speaks the phrase, not the section start');
  assert.equal(
    section.text.slice(locator.charStart, locator.charEnd),
    'timestamp, not a page',
    'char offsets index the section text in the original form',
  );
  const span = section.cueSpans!.find((s) => s.cueIdx === locator.cueIdx)!;
  assert.ok(span, 'the matched cue is one of the section spans');
  assert.equal(
    section.text.slice(span.textStart, span.textEnd).slice(locator.cueCharStart, locator.cueCharEnd),
    'timestamp, not a page',
    'cue offsets index the cue text, so the cue can be highlighted in the transcript reader',
  );
});

test('diacritics fold: plain ASCII query finds the accented transcript text', () => {
  const sections = transcriptSections();
  const hits = searchWorkSections(sections, { query: 'cafe' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.match.excerpt.match, 'Café');

  const jalapeno = searchWorkSections(sections, { query: 'jalapeno' });
  assert.equal(jalapeno.length, 1);
  assert.equal(jalapeno[0]!.match.excerpt.match, 'jalapeño');
});

test('matchCase and matchDiacritics are honoured', () => {
  const sections = transcriptSections();
  assert.equal(searchWorkSections(sections, { query: 'Spiral Search' }).length, 1);
  assert.equal(searchWorkSections(sections, { query: 'Spiral Search', matchCase: true }).length, 0);
  assert.equal(searchWorkSections(sections, { query: 'cafe', matchDiacritics: true }).length, 0, 'é ≠ e when diacritics matter');
});

test('whole-words does not match inside a word; contains does', () => {
  const sections = transcriptSections();
  assert.equal(searchWorkSections(sections, { query: 'rin', mode: 'contains' }).length >= 1, true);
  assert.equal(searchWorkSections(sections, { query: 'rin', mode: 'whole-words' }).length, 0);
  assert.equal(searchWorkSections(sections, { query: 'ring', mode: 'whole-words' }).length, 1);
});

test('fuzzy tolerates a typo', () => {
  const sections = transcriptSections();
  const hits = searchWorkSections(sections, { query: 'spiral serch', mode: 'fuzzy' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.match.excerpt.match, 'spiral search');
});

test('streaming: events arrive per work, progress and a final done tally', async () => {
  const works = [
    { workId: 'aaa', kind: 'video' as const, sections: transcriptSections() },
    { workId: 'bbb', kind: 'video' as const, sections: chunkCues(parseTranscript(readFileSync(new URL('../fixtures/sample.srt', import.meta.url), 'utf8'))) },
  ];
  const events: SpiralSearchEvent[] = [];
  for await (const e of searchWorks(works, { query: 'min*'.replace('*', 'ority report') })) events.push(e);

  const kinds = events.map((e) => e.kind);
  assert.equal(kinds[0], 'work');
  assert.equal(kinds[kinds.length - 1], 'done');
  assert.ok(kinds.includes('match'));
  assert.deepEqual(
    events.filter((e) => e.kind === 'work').map((e) => (e as { workId: string }).workId),
    ['aaa', 'bbb'],
  );

  const done = events[events.length - 1] as { kind: 'done'; works: number; matches: number };
  assert.equal(done.works, 2);
  assert.equal(done.matches, 1, 'only the SRT work mentions Minority Report');

  const matchEvent = events.find((e) => e.kind === 'match') as {
    kind: 'match';
    workId: string;
    sectionIdx: number;
    label: string;
    match: { locator: { tMs: number } };
  };
  assert.equal(matchEvent.workId, 'bbb');
  assert.equal(matchEvent.match.locator.tMs, 3000);
});

test('an empty query returns nothing rather than everything', () => {
  assert.deepEqual(searchWorkSections(transcriptSections(), { query: '   ' }), []);
});
