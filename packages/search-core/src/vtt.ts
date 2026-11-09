/**
 * Transcript parsing (WebVTT + SubRip) and cue chunking into search sections.
 *
 * Verified inputs: StreamStein already treats `.vtt/.srt/.ass/.ssa` as transcripts
 * (`src/ipc/youtubeCatalogScan.js:13`) and attaches a `transcriptPath` to each
 * video record. `.ass/.ssa` are not parsed here yet — they are out of scope for
 * the first proof and are reported as unsupported rather than silently empty.
 */

export interface Cue {
  idx: number;
  /** Inclusive start. */
  startMs: number;
  /** Exclusive end. */
  endMs: number;
  /** Plain text: tags stripped, VTT voice/class prefixes removed, lines joined. */
  text: string;
}

const TIME_RE =
  /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

const parseClock = (
  h: string | undefined,
  m: string,
  s: string,
  ms: string,
): number => {
  const hours = h ? Number(h) : 0;
  const millis = Number(ms.padEnd(3, '0'));
  return ((hours * 60 + Number(m)) * 60 + Number(s)) * 1000 + millis;
};

const stripCueMarkup = (raw: string): string =>
  raw
    .replace(/<(\d{2}:)?\d{2}:\d{2}[.,]\d{1,3}>/g, '') // SRT karaoke timestamps
    .replace(/<\/?[^>]+>/g, '') // <v Speaker>, <c.class>, <b>, <i>, <00:00:01.000>
    .replace(/\{\\[^}]*\}/g, '') // ASS override blocks, if they leak in
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * Parse VTT or SRT. Returns cues in file order. Throws on a format that is not
 * recognised, so a caller can never mistake "unparsed" for "empty transcript".
 */
export const parseTranscript = (raw: string): Cue[] => {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const cues: Cue[] = [];
  const seenStarts = new Set<number>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const m = TIME_RE.exec(line.trim());
    if (!m) {
      i += 1;
      continue;
    }
    const startMs = parseClock(m[1], m[2]!, m[3]!, m[4]!);
    const endMs = parseClock(m[5], m[6]!, m[7]!, m[8]!);
    i += 1;

    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      body.push(lines[i]!);
      i += 1;
    }
    const cueText = stripCueMarkup(body.join(' '));
    if (cueText.length === 0) continue;
    if (seenStarts.has(startMs)) continue; // de-dupe overlapping double-cue files
    seenStarts.add(startMs);
    cues.push({ idx: cues.length, startMs, endMs, text: cueText });
  }

  if (cues.length === 0 && !/-->/.test(text)) {
    throw new Error(
      'parseTranscript: no cues found and no cue timings present — not a VTT/SRT transcript',
    );
  }
  return cues;
};

export interface Chapter {
  title: string;
  startMs: number;
}

/**
 * Where a cue sits inside a section's text.
 *
 * Without this the only seek target available is "the start of the section",
 * which for a 700-character chunk can be a minute away from the passage that
 * matched. The span lets a match be resolved to the cue that actually speaks it.
 */
export interface CueSpan {
  cueIdx: number;
  startMs: number;
  endMs: number;
  /** Offset into the section text where this cue's text begins. */
  textStart: number;
  /** Offset into the section text where it ends (exclusive). */
  textEnd: number;
}

export interface SearchIndexSection {
  idx: number;
  label: string;
  text: string;
  /** First cue's start time in this chunk. */
  startMs: number;
  /** Index of the first cue in this chunk. */
  cueIdx: number;
  /** Cue offsets inside `text`, so a match can resolve to an exact cue. */
  cueSpans?: CueSpan[];
}

export interface ChunkOptions {
  /** Soft cap on characters per section. */
  maxChars?: number;
  /** Hard cap on cues per section. */
  maxCues?: number;
}

const mmss = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const chapterAt = (chapters: Chapter[] | undefined, tMs: number): string | null => {
  if (!chapters || chapters.length === 0) return null;
  let current: Chapter | null = null;
  for (const c of chapters) {
    if (c.startMs <= tMs) current = c;
    else break;
  }
  return current ? current.title : null;
};

/**
 * Group cues into searchable sections.
 *
 * A section is the video analogue of a book's spine section: the unit the index
 * stores and the unit a result's `label` names. Breaks happen at a chapter
 * boundary when one is available, otherwise on the size caps — never mid-cue.
 *
 * Section text is each cue's text joined by a single space, and every cue's
 * offsets inside that text are recorded, so a match can be resolved back to the
 * cue that speaks it. Cue text is normalised at parse time (see `stripCueMarkup`),
 * never here — re-normalising after joining would shift those offsets.
 */
export const chunkCues = (
  cues: Cue[],
  chapters?: Chapter[],
  opts: ChunkOptions = {},
): SearchIndexSection[] => {
  const maxChars = opts.maxChars ?? 700;
  const maxCues = opts.maxCues ?? 40;
  const sections: SearchIndexSection[] = [];
  let buf: Cue[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const first = buf[0]!;
    const label = chapterAt(chapters, first.startMs) ?? mmss(first.startMs);
    const parts: string[] = [];
    const cueSpans: CueSpan[] = [];
    let cursor = 0;
    for (const cue of buf) {
      if (parts.length > 0) cursor += 1; // the joining space
      const textStart = cursor;
      parts.push(cue.text);
      cursor = textStart + cue.text.length;
      cueSpans.push({
        cueIdx: cue.idx,
        startMs: cue.startMs,
        endMs: cue.endMs,
        textStart,
        textEnd: cursor,
      });
    }
    sections.push({
      idx: sections.length,
      label,
      text: parts.join(' '),
      startMs: first.startMs,
      cueIdx: first.idx,
      cueSpans,
    });
    buf = [];
  };

  for (const cue of cues) {
    const breaksChapter =
      buf.length > 0 &&
      chapterAt(chapters, buf[0]!.startMs) !== chapterAt(chapters, cue.startMs);
    const chars = buf.reduce((n, c) => n + c.text.length + 1, 0);
    if (breaksChapter || buf.length >= maxCues || chars >= maxChars) flush();
    buf.push(cue);
  }
  flush();
  return sections;
};
