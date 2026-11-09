import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { chunkCues, parseTranscript } from '../src/vtt.ts';

const vtt = readFileSync(new URL('../fixtures/sample.vtt', import.meta.url), 'utf8');
const srt = readFileSync(new URL('../fixtures/sample.srt', import.meta.url), 'utf8');

test('VTT: cues parsed with timings, tags stripped, wrapped lines joined', () => {
  const cues = parseTranscript(vtt);
  assert.equal(cues.length, 6, 'NOTE blocks and headers must not become cues');
  assert.equal(cues[0]!.startMs, 0);
  assert.equal(cues[0]!.endMs, 4200);
  assert.equal(cues[0]!.text, "So tonight we're looking at the spiral search —");
  assert.equal(
    cues[1]!.text,
    'a single query that walks the whole library at once.',
    'multi-line cues join with a space',
  );
  assert.equal(cues[4]!.text, 'Café, jalapeño — diacritics must fold away.');
});

test('SRT: parsed by the same parser, markup and line breaks handled', () => {
  const cues = parseTranscript(srt);
  assert.equal(cues.length, 3);
  assert.equal(cues[0]!.startMs, 1000);
  assert.equal(cues[0]!.text, 'Bold text with a line break continuing here.');
  assert.equal(cues[1]!.text, 'Second cue mentions Minority Report.');
});

test('a file that is not a transcript throws instead of looking empty', () => {
  assert.throws(() => parseTranscript('just some prose, no cue timings'), /not a VTT\/SRT transcript/);
});

test('cues chunk into sections, labelled by chapter when chapters exist', () => {
  const cues = parseTranscript(vtt);
  const chapters = [
    { title: 'Intro', startMs: 0 },
    { title: 'The dial', startMs: 9000 },
    { title: 'Transcripts', startMs: 28000 },
  ];
  const sections = chunkCues(cues, chapters, { maxChars: 120, maxCues: 3 });
  const chapterOf = (ms: number) =>
    [...chapters].filter((c) => c.startMs <= ms).pop()!.title;

  assert.ok(sections.length >= 3, `expected several sections, got ${sections.length}`);
  assert.equal(sections[0]!.idx, 0);
  assert.equal(sections[0]!.label, 'Intro');
  assert.equal(sections[0]!.startMs, 0);
  assert.equal(sections[0]!.cueIdx, 0);

  for (const section of sections) {
    const owned = new Set(section.cueSpans!.map((s) => chapterOf(s.startMs)));
    assert.equal(owned.size, 1, `section ${section.idx} must not span two chapters`);
    assert.equal(section.label, [...owned][0], 'the label names the chapter the section is in');
  }
});

test('cue spans address the section text exactly', () => {
  const cues = parseTranscript(vtt);
  for (const section of chunkCues(cues, undefined, { maxCues: 2 })) {
    assert.ok(section.cueSpans && section.cueSpans.length > 0);
    for (const span of section.cueSpans!) {
      assert.equal(
        section.text.slice(span.textStart, span.textEnd),
        cues[span.cueIdx]!.text,
        'span offsets must slice the cue back out of the section text',
      );
      assert.equal(span.startMs, cues[span.cueIdx]!.startMs);
    }
    // Spans are ordered, disjoint and cover the text with single-space joins.
    for (let i = 1; i < section.cueSpans!.length; i += 1) {
      assert.equal(section.cueSpans![i]!.textStart, section.cueSpans![i - 1]!.textEnd + 1);
    }
    assert.equal(section.cueSpans![section.cueSpans!.length - 1]!.textEnd, section.text.length);
  }
});

test('without chapters the label is the start time, and index order is stable', () => {
  const cues = parseTranscript(vtt);
  const sections = chunkCues(cues, undefined, { maxCues: 2 });
  assert.deepEqual(sections.map((s) => s.label), ['00:00', '00:09', '00:21']);
  assert.deepEqual(sections.map((s) => s.startMs), [0, 9500, 21400]);
  assert.deepEqual(sections.map((s) => s.idx), sections.map((_, i) => i));
  const reassembled = sections.map((s) => s.text).join(' ');
  for (const cue of cues) assert.ok(reassembled.includes(cue.text), `cue text retained: ${cue.text.slice(0, 24)}…`);
});
