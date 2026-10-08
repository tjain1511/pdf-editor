/**
 * "Edit existing text" in place.
 *
 * The original glyphs are removed from the page content (their text-showing
 * operators are blanked while keeping the advance) and an editable text
 * element is placed at the same spot with the detected font class, weight,
 * slant, size, baseline, colour and width. No background is painted, so the
 * page behind the text stays untouched. When the original glyphs cannot be
 * removed (encrypted or unusual files, partial selections) the old approach
 * of covering them with a box in the sampled background colour is used.
 */
import { addElements, setTool } from './actions';
import { newId } from './assets';
import { createCover, createText } from './factory';
import { getState, notify } from './store';
import type { EditorPage, FontFamily, Rect, TextElement, TextRemoval } from './types';
import { TEXT_PADDING, baselineFor, measureText } from '../pdf/fonts';
import { lineGroup, lineText, type TextRun } from '../pdf/textContent';
import { detectColors, detectFont } from '../pdf/textStyle';
import { canRemoveText, getDisplayPage } from '../pdf/displayPage';
import { analyzeShowOps, matchShowOps, removalFor, type ShowOp, type TextSpan } from '../pdf/textOps';
import { getEmbeddedFont, registerEmbeddedFont, segmentText } from '../pdf/embeddedFonts';
import { getSourcePage } from '../pdf/sources';

export interface ReplaceSpec {
  /** Rects (page points) of the original text, one per line. */
  rects: Rect[];
  text: string;
  /** Font size in points. */
  fontSize: number;
  /** Baseline y of the first line in page points. */
  baseline: number;
  /** Runs of the original text (used for font detection and glyph removal). */
  runs: TextRun[];
  /** Width of the first original line, used to fit the replacement. */
  originalWidth: number;
  /** True when only part of the original text was selected. */
  partial: boolean;
}

/** Spec for the whole visual line containing run `index`. */
export function specForLine(runs: TextRun[], index: number): ReplaceSpec {
  const group = lineGroup(runs, index);
  const members = group.map((i) => runs[i]);
  const run = runs[index];
  const x = Math.min(...members.map((r) => r.x));
  const right = Math.max(...members.map((r) => r.x + r.width));
  const y = Math.min(...members.map((r) => r.y));
  const bottom = Math.max(...members.map((r) => r.y + r.height));
  return {
    rects: [{ x, y, width: right - x, height: bottom - y }],
    text: lineText(runs, group),
    fontSize: run.height,
    baseline: run.y + run.ascent * run.height,
    runs: members,
    originalWidth: right - x,
    partial: false,
  };
}

let pending = false;

export async function replaceText(pageIndex: number, spec: ReplaceSpec): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    const state = getState();
    const page: EditorPage | undefined = state.pages[pageIndex];
    if (!page || !page.source) return;
    const settings = state.toolSettings;
    const run = spec.runs[0] ?? null;

    // Try to remove the original glyphs from the page content.
    let removal: TextRemoval | null = null;
    let matchedOps: ShowOp[] = [];
    let embeddedFont: string | null = null;
    if (canRemoveText(page) && spec.runs.length) {
      try {
        const sourcePage = await getSourcePage(page.source.sourceId, page.source.pageIndex);
        const [analysis] = await Promise.all([analyzeShowOps(sourcePage), getDisplayPage(page)]);
        // Runs and operators share the page's user space, so spans come straight from the runs.
        const spans: TextSpan[] = spec.runs.map((r) => ({ start: r.userStart, dir: r.userDir, length: r.width, height: r.height }));
        const alreadyRemoved = new Set(page.removals.flatMap((x) => x.ops.map((o) => o.ordinal)));
        const candidates = analysis.ops.filter((op) => !alreadyRemoved.has(op.ordinal));
        const matched = matchShowOps(candidates, spans, spec.partial);
        if (matched && matched.length) {
          matchedOps = matched;
          removal = removalFor(newId(), matched);
          // Reuse the document's font when the whole selection uses one font.
          const fontNames = new Set(matched.map((op) => op.fontName));
          if (fontNames.size === 1) embeddedFont = await registerEmbeddedFont(page, matched[0].fontName, analysis);
        }
      } catch (err) {
        console.warn('Text removal unavailable, falling back to cover', err);
      }
    }

    const [font, sampled] = await Promise.all([
      run ? detectFont(page, run) : Promise.resolve(null),
      // Colour sampling is only needed as a fallback (no operator colour) or for the cover.
      !matchedOps.length ? detectColors(page, unionRect(spec.rects)) : Promise.resolve(null),
    ]);
    // The document may have changed while detecting.
    if (getState().pages[pageIndex] !== page) return;

    const fontFamily: FontFamily = font?.fontFamily ?? (run?.mono ? 'Courier' : run?.serif ? 'Times' : 'Helvetica');
    const bold = font?.bold ?? run?.bold ?? false;
    const italic = font?.italic ?? run?.italic ?? false;
    const fontSize = Math.max(4, Math.round(spec.fontSize * 10) / 10);
    const color = matchedOps.length ? dominantColor(matchedOps) : sampled?.text ?? settings.textColor;

    const covers = removal
      ? []
      : spec.rects.map((r) =>
          createCover({ x: r.x - 0.5, y: r.y - 0.5, width: r.width + 1, height: r.height + 1 }, sampled?.background ?? settings.coverColor),
        );

    const first = spec.rects[0];
    // Only keep the document font if it can draw the text we are starting from.
    const embeddedInfo = getEmbeddedFont(embeddedFont);
    if (embeddedInfo && segmentText(spec.text, embeddedInfo).some((seg) => !seg.embedded)) embeddedFont = null;
    const probe: TextElement = createText({ x: 0, y: 0, width: 10_000, height: 0 }, settings, {
      text: spec.text,
      fontFamily,
      fontSize,
      bold,
      italic,
      color,
      embeddedFont,
    });
    const firstLine = spec.text.split('\n')[0] ?? '';
    const natural = measureText(firstLine, probe);
    // Scale glyphs horizontally so the replacement spans the same width as the original
    // (not needed when the original font itself is reused).
    let hScale = 1;
    if (!embeddedFont && natural > 0 && spec.originalWidth > 0 && firstLine.trim()) {
      hScale = Math.min(1.5, Math.max(0.6, spec.originalWidth / natural));
      hScale = Math.round(hScale * 1000) / 1000;
    }
    const longest = Math.max(...spec.text.split('\n').map((line) => measureText(line, probe) * hScale), spec.originalWidth);
    const width = longest + TEXT_PADDING * 2 + fontSize * 0.5;
    const y = spec.baseline - baselineFor(probe, 0);
    const text = createText({ x: first.x - TEXT_PADDING, y, width, height: 0 }, settings, {
      text: spec.text,
      fontFamily,
      fontSize,
      bold,
      italic,
      color,
      hScale,
      autoWidth: true,
      embeddedFont,
    });
    addElements(pageIndex, [...covers, text], { select: [text.id], edit: text.id, removal });
    setTool('select');
    if (!removal && canRemoveText(page)) {
      notify('The original text could not be removed cleanly, so it was covered instead.', 'info');
    }
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Could not prepare the text for editing.', 'error');
  } finally {
    pending = false;
  }
}

/** Most common fill colour among the matched operators (weighted by advance). */
function dominantColor(ops: ShowOp[]): string {
  const weights = new Map<string, number>();
  for (const op of ops) weights.set(op.color, (weights.get(op.color) ?? 0) + Math.abs(op.advance) + 0.01);
  let best = ops[0].color;
  let bestW = -1;
  for (const [c, w] of weights) {
    if (w > bestW) {
      best = c;
      bestW = w;
    }
  }
  return best;
}

function unionRect(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}
