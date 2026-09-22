// ABS Zalo Rich Text & Auto Styling Engine
// Converts Markdown and color tags into native Zalo TextStyle formatting
// Preserves styled content within UTF-16, style-count, and encoded-byte budgets.

import { latexToUnicode } from "./zalo_math.js";

export const ZALO_STYLES = {
  Bold: "b",
  Italic: "i",
  Underline: "u",
  StrikeThrough: "s",
  RubyRed: "c_db342e",
  EmeraldGreen: "c_15a85f",
  AmberOrange: "c_f27806",
  RoyalGold: "c_f7b503",
  HeaderLarge: "f_18",
  HeaderSmall: "f_13",
  UnorderedList: "lst_1",
  OrderedList: "lst_2",
  Indent: "ind_$",
};

export const MAX_ZALO_STYLE_JSON_LENGTH = 250;
export const MAX_ZALO_STYLES = 40;
export const MAX_ZALO_UTF16_LENGTH = 2000;
export const MAX_ZALO_PAYLOAD_BYTES = 3000;

/**
 * Measure payload volume in UTF-8 bytes (text + style JSON length).
 * Zalo web servers reject messages where text bytes + style JSON length >= 3,448 bytes.
 * Keeping under 3,000 bytes ensures 100% safe delivery for Vietnamese text & emoji.
 */
export function measurePayloadBytes(msg, styles) {
  const text = typeof msg === "string" ? msg : String(msg?.msg || msg?.text || "");
  const textBytes = Buffer.byteLength(text, "utf8");
  const styleList = styles || msg?.styles;
  const styleBytes = Array.isArray(styleList) && styleList.length > 0 ? JSON.stringify(styleList).length : 0;
  return textBytes + styleBytes;
}

/**
 * Measure string length in UTF-16 code units (Zalo's internal character counter).
 */
export function measureUtf16Length(str) {
  return typeof str === "string" ? str.length : 0;
}

/**
 * Score style priority so essential formatting (Headings, Colors) survives JSON budget cuts.
 */
function getStylePriority(st) {
  switch (st) {
    case ZALO_STYLES.HeaderLarge:
    case ZALO_STYLES.HeaderSmall:
      return 100;
    case ZALO_STYLES.RubyRed:
    case ZALO_STYLES.EmeraldGreen:
    case ZALO_STYLES.AmberOrange:
    case ZALO_STYLES.RoyalGold:
      return 80;
    case ZALO_STYLES.Bold:
      return 60;
    case ZALO_STYLES.Underline:
    case ZALO_STYLES.StrikeThrough:
      return 40;
    case ZALO_STYLES.Italic:
      return 20;
    default:
      return 10;
  }
}

/**
 * Cap styles for legacy callers that request a smaller serialized-style budget.
 * Lower-priority styles are pruned first; current outbound chunking separately
 * enforces the complete UTF-16, style-count, and encoded-byte contract.
 */
export function capStyles(styles, maxJsonLength = MAX_ZALO_STYLE_JSON_LENGTH) {
  if (!Array.isArray(styles) || styles.length === 0) return [];
  if (JSON.stringify(styles).length <= maxJsonLength) return styles;

  // Clone and annotate with original index and priority
  const items = styles.map((s, idx) => ({
    style: s,
    priority: getStylePriority(s.st),
    idx,
  }));

  // Sort ascending by priority so lowest priority items are removed first
  items.sort((a, b) => a.priority - b.priority);

  const retained = new Set(styles);
  while (items.length > 0 && JSON.stringify(Array.from(retained)).length > maxJsonLength) {
    const lowest = items.shift();
    retained.delete(lowest.style);
  }

  // Restore original ordering by start position
  return styles.filter((s) => retained.has(s));
}

/** Split plain text into provider-safe Zalo bubbles without losing characters. */
export function splitIntoSafeZaloChunks(text, maxCharsPerChunk = MAX_ZALO_UTF16_LENGTH) {
  return chunkZaloStyledText(text, [], { maxUtf16: maxCharsPerChunk }).map((chunk) => chunk.msg);
}

function normalizedStyles(styles, textLength) {
  if (!Array.isArray(styles)) return [];
  return styles
    .map((style) => ({
      start: Math.max(0, Number(style?.start) || 0),
      len: Math.max(0, Number(style?.len) || 0),
      st: String(style?.st || ""),
    }))
    .filter((style) => style.st && style.len > 0 && style.start < textLength)
    .map((style) => ({ ...style, len: Math.min(style.len, textLength - style.start) }))
    .sort((a, b) => a.start - b.start || b.len - a.len);
}

function stylesForRange(styles, start, end, maxStyles = MAX_ZALO_STYLES) {
  return styles
    .filter((style) => style.start < end && style.start + style.len > start)
    .map((style) => ({
      start: Math.max(style.start, start) - start,
      len: Math.min(style.start + style.len, end) - Math.max(style.start, start),
      st: style.st,
    }))
    .slice(0, maxStyles);
}

function codePointEnds(text, start, maxUtf16) {
  const ends = [];
  let cursor = start;
  while (cursor < text.length) {
    const width = text.codePointAt(cursor) > 0xffff ? 2 : 1;
    if (cursor + width - start > maxUtf16) break;
    cursor += width;
    ends.push(cursor);
  }
  return ends;
}

function readableBoundary(text, start, maxEnd) {
  const slice = text.slice(start, maxEnd);
  const threshold = Math.floor(slice.length * 0.55);
  const accept = (index) => (index >= threshold ? start + index : 0);
  const paragraph = slice.lastIndexOf("\n\n");
  if (paragraph >= 0 && accept(paragraph + 2)) return start + paragraph + 2;
  const line = slice.lastIndexOf("\n");
  if (line >= 0 && accept(line + 1)) return start + line + 1;
  let sentence = 0;
  for (const match of slice.matchAll(/[.!?…。！？](?:[ \t]+|$)/gu)) {
    sentence = match.index + match[0].length;
  }
  if (sentence && accept(sentence)) return start + sentence;
  const space = slice.lastIndexOf(" ");
  if (space >= 0 && accept(space + 1)) return start + space + 1;
  return maxEnd;
}

/** Split rendered text while clipping/rebasing native Zalo styles. */
export function chunkZaloStyledText(
  text,
  styles = [],
  {
    maxUtf16 = MAX_ZALO_UTF16_LENGTH,
    maxStyles = MAX_ZALO_STYLES,
    maxPayloadBytes = MAX_ZALO_PAYLOAD_BYTES,
  } = {},
) {
  const body = String(text || "");
  if (!body) return [];
  if (!Number.isInteger(maxUtf16) || maxUtf16 < 1) throw new Error("invalid_zalo_utf16_limit");
  if (!Number.isInteger(maxStyles) || maxStyles < 1) throw new Error("invalid_zalo_style_limit");
  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 64) throw new Error("invalid_zalo_payload_limit");

  const safeStyles = normalizedStyles(styles, body.length);
  const chunks = [];
  let start = 0;
  while (start < body.length) {
    const ends = codePointEnds(body, start, maxUtf16);
    if (!ends.length) throw new Error("zalo_chunk_boundary_unavailable");

    let low = 0;
    let high = ends.length - 1;
    let best = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const end = ends[middle];
      const clipped = stylesForRange(safeStyles, start, end, maxStyles);
      const fits = measurePayloadBytes(body.slice(start, end), clipped) <= maxPayloadBytes;
      if (fits) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    const maxEnd = ends[Math.max(best, 0)];
    let end = maxEnd === body.length ? maxEnd : readableBoundary(body, start, maxEnd);
    let clipped = stylesForRange(safeStyles, start, end, maxStyles);
    while (end > start && measurePayloadBytes(body.slice(start, end), clipped) > maxPayloadBytes) {
      const prior = ends.findLast((candidate) => candidate < end);
      if (!prior) break;
      end = prior;
      clipped = stylesForRange(safeStyles, start, end, maxStyles);
    }
    while (clipped.length && measurePayloadBytes(body.slice(start, end), clipped) > maxPayloadBytes) {
      clipped.pop();
    }
    if (measurePayloadBytes(body.slice(start, end), clipped) > maxPayloadBytes) {
      throw new Error("zalo_payload_budget_too_small");
    }
    if (end <= start) throw new Error("zalo_payload_budget_too_small");
    chunks.push({ msg: body.slice(start, end), styles: clipped });
    start = end;
  }
  return chunks;
}

/**
 * Parse Markdown syntax and color tags into clean text and Zalo style structures.
 * Supported:
 *   # Heading 1 -> Bold + Large + Ruby Red
 *   ## Heading 2 -> Bold + Emerald Green
 *   ### Heading 3 -> Bold + Amber Orange
 *   **bold** -> Bold
 *   *italic* -> Italic
 *   __underline__ -> Underline
 *   ~~strikethrough~~ -> StrikeThrough
 *   [RED]...[/RED] or [ĐỎ]...[/ĐỎ] -> Bold + Ruby Red
 *   [GREEN]...[/GREEN] or [XANH]...[/XANH] -> Bold + Emerald Green
 *   [ORANGE]...[/ORANGE] or [CAM]...[/CAM] -> Bold + Amber Orange
 *   [YELLOW]...[/YELLOW] or [VÀNG]...[/VÀNG] -> Bold + Royal Gold
 */
function colorStyleForTag(tag) {
  const key = String(tag || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/Đ/gu, "D")
    .toUpperCase();
  if (key === "RED" || key === "DO") return ZALO_STYLES.RubyRed;
  if (key === "GREEN" || key === "XANH") return ZALO_STYLES.EmeraldGreen;
  if (key === "ORANGE" || key === "CAM") return ZALO_STYLES.AmberOrange;
  if (key === "YELLOW" || key === "VANG") return ZALO_STYLES.RoyalGold;
  return "";
}

function parseInlineMarkdown(source, baseOffset) {
  const output = [];
  const styles = [];
  const stacks = new Map();
  let outputLength = 0;
  const append = (value) => {
    output.push(value);
    outputLength += value.length;
  };
  const open = (key, styleList) => {
    const stack = stacks.get(key) || [];
    stack.push({ start: baseOffset + outputLength, styleList });
    stacks.set(key, stack);
  };
  const close = (key) => {
    const stack = stacks.get(key);
    const item = stack?.pop();
    if (!item) return false;
    const len = baseOffset + outputLength - item.start;
    if (len > 0) {
      for (const st of item.styleList) styles.push({ start: item.start, len, st });
    }
    return true;
  };

  for (let index = 0; index < source.length;) {
    const rest = source.slice(index);
    const color = rest.match(/^\[(\/)?(RED|GREEN|ORANGE|YELLOW|ĐỎ|DO|XANH|CAM|VÀNG|VANG)\]/iu);
    if (color) {
      const style = colorStyleForTag(color[2]);
      const key = `color:${style}`;
      if (color[1]) {
        if (!close(key)) append(color[0]);
      } else {
        const closeTag = new RegExp(`\\[\\/(?:${color[2]})\\]`, "iu");
        if (closeTag.test(source.slice(index + color[0].length))) {
          open(key, [ZALO_STYLES.Bold, style]);
        } else {
          append(color[0]);
        }
      }
      index += color[0].length;
      continue;
    }

    if (source[index] === "`") {
      const closing = source.indexOf("`", index + 1);
      if (closing > index) {
        append(source.slice(index + 1, closing));
        index = closing + 1;
        continue;
      }
    }

    const link = rest.match(/^\[(.+?)\]\((https?:\/\/[^)]+)\)/iu);
    if (link) {
      append(`${link[1]}: ${link[2]}`);
      index += link[0].length;
      continue;
    }

    const marker = [
      ["**", ZALO_STYLES.Bold],
      ["__", ZALO_STYLES.Underline],
      ["~~", ZALO_STYLES.StrikeThrough],
      ["*", ZALO_STYLES.Italic],
      ["_", ZALO_STYLES.Italic],
    ].find(([token]) => source.startsWith(token, index));
    if (marker) {
      const [token, style] = marker;
      const key = `markdown:${token}`;
      if (stacks.get(key)?.length) {
        close(key);
        index += token.length;
        continue;
      }
      if (source.indexOf(token, index + token.length) >= 0) {
        open(key, [style]);
        index += token.length;
        continue;
      }
    }

    const char = String.fromCodePoint(source.codePointAt(index));
    append(char);
    index += char.length;
  }

  return { text: output.join(""), styles };
}

/** Parse the supported Markdown/color subset into native Zalo styles. */
export function parseMarkdownStyles(input) {
  const normalized = latexToUnicode(String(input || ""))
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  if (!normalized) return { text: "", styles: [] };

  const output = [];
  const styles = [];
  let outputLength = 0;
  let fencedCode = false;
  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    let source = lines[index];
    if (/^\s*```/u.test(source)) {
      fencedCode = !fencedCode;
      continue;
    }

    const lineStart = outputLength;
    let parsed;
    let headingStyles = [];
    if (fencedCode) {
      parsed = { text: source, styles: [] };
    } else {
      const heading = source.match(/^(#{1,3})\s+(.+)$/u);
      if (heading) {
        source = heading[2];
        headingStyles = heading[1].length === 1
          ? [ZALO_STYLES.Bold, ZALO_STYLES.HeaderLarge, ZALO_STYLES.RubyRed]
          : heading[1].length === 2
            ? [ZALO_STYLES.Bold, ZALO_STYLES.EmeraldGreen]
            : [ZALO_STYLES.Bold, ZALO_STYLES.AmberOrange];
      } else {
        source = source.replace(/^(\s*)[-+*]\s+/u, "$1• ");
      }
      parsed = parseInlineMarkdown(source, lineStart);
    }

    output.push(parsed.text);
    outputLength += parsed.text.length;
    styles.push(...parsed.styles);
    for (const st of headingStyles) {
      if (parsed.text.length) styles.push({ start: lineStart, len: parsed.text.length, st });
    }
    const numbered = parsed.text.match(/^\s*(\d+)\.\s+/u);
    if (numbered) {
      styles.push({
        start: lineStart + parsed.text.indexOf(numbered[1]),
        len: numbered[1].length,
        st: ZALO_STYLES.EmeraldGreen,
      });
    }
    if (index < lines.length - 1) {
      output.push("\n");
      outputLength += 1;
    }
  }

  return { text: output.join("").replace(/\n{3,}/g, "\n\n"), styles };
}

/**
 * Format message into ready-to-send Zalo payload with styles.
 * Automatically enforces max JSON budget (~250 bytes) for style payload.
 */
export function buildZaloStyledMessage(text, { maxStylesJsonLength = MAX_ZALO_STYLE_JSON_LENGTH } = {}) {
  const { text: cleanText, styles } = parseMarkdownStyles(text);
  const cappedStyles = capStyles(styles, maxStylesJsonLength);
  return {
    msg: cleanText,
    styles: cappedStyles.length > 0 ? cappedStyles : undefined,
  };
}

export function formatAndChunkZaloMarkdown(text, options = {}) {
  const parsed = parseMarkdownStyles(text);
  return chunkZaloStyledText(parsed.text, parsed.styles, options);
}
