// ── LLM-phrase → highlight-HTML hydration ────────────────────────────────────
// Converts the raw phrase strings stored in `paa-llm-grades` (semicolon-
// separated quoted strings, e.g. `"phrase A"; "phrase B"`) into the
// `annotation_html` shape the grading UI already renders for human-made
// annotations: the transcript text with each phrase wrapped in
// `<span class="hl hl-{frame}">…</span>`.
//
// Challenges handled:
//   - Phrase strings can contain `...` to elide middle material the LLM
//     skipped. We split on `...` and try to match each piece independently
//     so non-contiguous evidence still highlights what it can.
//   - Phrases may not match the transcript verbatim (paraphrase, whitespace
//     normalization). Unmatched pieces are counted and returned in the
//     diagnostics object so we can spot a bad import quickly.
//   - Already-wrapped spans (overlap with a previously-wrapped frame) are
//     left alone; later wraps skip already-tagged ranges.

// Escape regex metacharacters in a phrase before searching.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strip the surrounding quotes (and any leading/trailing whitespace) that
// the CSV puts around each phrase.
function unquote(s) {
  const trimmed = s.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Split the LLM's phrases-cell into individual phrase strings. The CSV has
// each phrase wrapped in `"..."`, joined with `; ` between phrases. We use
// a simple state machine over the characters rather than a regex split
// because phrases may contain commas/quotes inside their own text.
function splitPhrases(cell) {
  if (!cell || typeof cell !== 'string') return [];
  const out = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i];
    if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
    if (!inQuote && ch === ';') {
      const v = unquote(buf);
      if (v) out.push(v);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const last = unquote(buf);
  if (last) out.push(last);
  return out;
}

// Break a phrase on `...` ellipses into the contiguous substrings the LLM
// actually quoted. Each piece is searched independently in the transcript.
function shatterByEllipsis(phrase) {
  return phrase
    .split(/\s*\.{3}\s*|\s*…\s*/)
    .map(p => p.trim())
    .filter(Boolean);
}

const FRAMES = ['s', 't', 'a', 'r'];

// Build the hydrated HTML for a single (transcript, llmRow) pair.
//
// Returns { html, diagnostics } where diagnostics is:
//   { matched: { s, t, a, r }, unmatched: { s: ['piece', ...], ... },
//     pieces_total, pieces_matched }
function hydratePhrases(transcript, llmRow) {
  const diagnostics = {
    matched:    { s: 0, t: 0, a: 0, r: 0 },
    unmatched:  { s: [], t: [], a: [], r: [] },
    pieces_total: 0,
    pieces_matched: 0,
  };

  if (!transcript || typeof transcript !== 'string' || !llmRow) {
    return { html: transcript || '', diagnostics };
  }

  // Collect all (start, end, frame) ranges to wrap. We scan once, then build
  // the HTML by interleaving wraps and plain text — this avoids the
  // re-wrap-already-wrapped-content problem and lets us drop overlapping
  // ranges deterministically.
  const ranges = []; // { start, end, frame }
  for (const frame of FRAMES) {
    const raw = llmRow[`${frame}_phrases`];
    const phrases = splitPhrases(raw);
    for (const phrase of phrases) {
      const pieces = shatterByEllipsis(phrase);
      for (const piece of pieces) {
        if (piece.length < 3) continue; // skip noise like trailing punctuation
        diagnostics.pieces_total++;
        const re = new RegExp(escapeRegex(piece), 'i'); // case-insensitive first hit
        const m = re.exec(transcript);
        if (m) {
          ranges.push({ start: m.index, end: m.index + m[0].length, frame });
          diagnostics.matched[frame]++;
          diagnostics.pieces_matched++;
        } else {
          diagnostics.unmatched[frame].push(piece.length > 80 ? piece.slice(0, 80) + '…' : piece);
        }
      }
    }
  }

  if (ranges.length === 0) {
    return { html: escapeHtml(transcript), diagnostics };
  }

  // STAR frames legitimately overlap — the same sentence is often both the
  // Situation and the Task, and one frame's phrase can be fully contained in
  // another's. We therefore emit NESTED highlight spans instead of dropping the
  // overlapping range, mirroring what the grading UI allows a human annotator to
  // do (multiple tags on the same text). buildNestedHtml() produces valid HTML:
  // a frame stays a single continuous span where it can, and only splits/reopens
  // where ranges genuinely cross.
  return { html: buildNestedHtml(transcript, ranges), diagnostics };
}

// Render arbitrarily-overlapping {start, end, frame} ranges as valid nested
// highlight HTML. Classic sweep over boundary points with an open-span stack:
// at each atomic segment we compute which frames cover it (outermost = earliest
// start, then longest), diff against the currently-open stack, close spans past
// the common prefix, and open the rest. Containment nests cleanly; crossing
// overlaps split the inner frame into adjacent spans (still valid, still tagged).
function buildNestedHtml(transcript, ranges) {
  const valid = ranges.filter(r => r.end > r.start);
  if (valid.length === 0) return escapeHtml(transcript);

  const points = new Set([0, transcript.length]);
  for (const r of valid) { points.add(r.start); points.add(r.end); }
  const bounds = [...points]
    .filter(p => p >= 0 && p <= transcript.length)
    .sort((a, b) => a - b);

  let out = '';
  const stack = []; // frame letters currently open, outermost first

  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b <= a) continue;

    // Frames covering this whole segment, outermost-first, de-duplicated.
    const active = [...new Set(
      valid
        .filter(r => r.start <= a && r.end >= b)
        .sort((x, y) => x.start - y.start || y.end - x.end || x.frame.localeCompare(y.frame))
        .map(r => r.frame)
    )];

    let common = 0;
    while (common < stack.length && common < active.length && stack[common] === active[common]) common++;
    while (stack.length > common) { out += '</span>'; stack.pop(); }
    for (let k = common; k < active.length; k++) {
      out += `<span class="hl hl-${active[k]}">`;
      stack.push(active[k]);
    }

    out += escapeHtml(transcript.slice(a, b));
  }
  while (stack.length) { out += '</span>'; stack.pop(); }

  return out;
}

// Escape only the characters that matter in element *content* (& < >), matching
// how the browser serialises a text node into innerHTML. We deliberately do NOT
// escape ' or " — the text is never placed in an attribute, and escaping them
// makes the hydrated `annotation_html` (and therefore the CSV export) diverge
// from human-made highlights, which keep apostrophes/quotes literal.
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Map the LLM's "Yes" / "No" presence flags onto the grading UI's "yes" / "no"
// radio values. Anything else returns undefined so the radios stay un-set
// (annotator must explicitly choose).
function presentToYn(v) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (t === 'yes') return 'yes';
  if (t === 'no')  return 'no';
  return undefined;
}

// Convert an LLM grade row to the `grades` object shape the UI consumes.
// Score columns that are null/undefined in the LLM row are emitted as
// undefined so the radio buttons render un-selected for that frame.
function buildHydratedGrades(llmRow) {
  if (!llmRow) return {};
  return {
    g_s_yn:  presentToYn(llmRow.s_present),
    g_s_sc:  llmRow.s_score ?? undefined,
    g_t_yn:  presentToYn(llmRow.t_present),
    g_t_sc:  llmRow.t_score ?? undefined,
    g_a_yn:  presentToYn(llmRow.a_present),
    g_a_sc:  llmRow.a_score ?? undefined,
    g_r_yn:  presentToYn(llmRow.r_present),
    g_r_sc:  llmRow.r_score ?? undefined,
    g_bars:  llmRow.bars    ?? undefined,
  };
}

module.exports = { hydratePhrases, buildHydratedGrades, presentToYn };
