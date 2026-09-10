// ABS Zalo Rich Text & Auto Styling Engine
// Converts Markdown and color tags into native Zalo TextStyle formatting
// Ensures message chunks stay within safe bubble limits (<= 650 chars).

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
export const MAX_ZALO_UTF16_LENGTH = 2800;

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
 * Cap Zalo styles to prevent exceeding Zalo's JSON style payload ceiling (~256 bytes).
 * When over budget, lower-priority styles (italic, bold) are pruned first
 * while preserving high-priority headings and colors.
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

/**
 * Split text into chunks safe for Zalo's message length limits.
 * Default max is 650 chars to avoid error 118 (content too long).
 */
export function splitIntoSafeZaloChunks(text, maxCharsPerChunk = 650) {
  if (!text) return [];

  const rawParagraphs = String(text)
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let currentBuffer = "";

  for (const para of rawParagraphs) {
    if (para.length > maxCharsPerChunk) {
      const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if ((currentBuffer + "\n" + line).trim().length <= maxCharsPerChunk) {
          currentBuffer = currentBuffer ? `${currentBuffer}\n${line}` : line;
        } else {
          if (currentBuffer) chunks.push(currentBuffer.trim());
          if (line.length > maxCharsPerChunk) {
            for (let i = 0; i < line.length; i += maxCharsPerChunk) {
              chunks.push(line.slice(i, i + maxCharsPerChunk).trim());
            }
            currentBuffer = "";
          } else {
            currentBuffer = line;
          }
        }
      }
    } else {
      if ((currentBuffer + "\n\n" + para).trim().length <= maxCharsPerChunk) {
        currentBuffer = currentBuffer ? `${currentBuffer}\n\n${para}` : para;
      } else {
        if (currentBuffer) chunks.push(currentBuffer.trim());
        currentBuffer = para;
      }
    }
  }

  if (currentBuffer) {
    chunks.push(currentBuffer.trim());
  }

  return chunks.filter((c) => c.length > 0);
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
export function parseMarkdownStyles(input) {
  let text = String(input || "");
  const styles = [];

  // 1. Process headings line by line
  const lines = text.split("\n");
  const processedLines = [];
  const headingStyles = [];
  let charCount = 0;

  for (let line of lines) {
    let hType = 0;
    // Strip markdown horizontal rules (---, ***, ___) to avoid ugly wide gap in Zalo mobile
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      line = "";
    }

    if (line.startsWith("# ")) {
      hType = 1;
      line = line.slice(2);
    } else if (line.startsWith("## ")) {
      hType = 2;
      line = line.slice(3);
    } else if (line.startsWith("### ")) {
      hType = 3;
      line = line.slice(4);
    }

    const start = charCount;
    const len = line.length;

    if (hType === 1 && len > 0) {
      headingStyles.push(
        { start, len, st: ZALO_STYLES.Bold },
        { start, len, st: ZALO_STYLES.HeaderLarge },
        { start, len, st: ZALO_STYLES.RubyRed }
      );
    } else if (hType === 2 && len > 0) {
      headingStyles.push(
        { start, len, st: ZALO_STYLES.Bold },
        { start, len, st: ZALO_STYLES.EmeraldGreen }
      );
    } else if (hType === 3 && len > 0) {
      headingStyles.push(
        { start, len, st: ZALO_STYLES.Bold },
        { start, len, st: ZALO_STYLES.AmberOrange }
      );
    }
    processedLines.push(line);
    charCount += line.length + 1; // +1 for newline character
  }
  text = processedLines.join("\n");
  styles.push(...headingStyles);

  // Helper function to replace regex patterns and adjust style positions
  function replaceTag(regex, styleList) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchStart = match.index;
      const fullLen = match[0].length;
      const innerText = match[1];
      const innerLen = innerText.length;
      const delta = fullLen - innerLen;

      text = text.slice(0, matchStart) + innerText + text.slice(matchStart + fullLen);

      // Adjust existing style offsets that occur after this match
      for (const s of styles) {
        if (s.start >= matchStart + fullLen) {
          s.start -= delta;
        } else if (s.start >= matchStart) {
          s.len = Math.max(0, s.len - delta);
        }
      }

      for (const st of styleList) {
        styles.push({ start: matchStart, len: innerLen, st });
      }

      regex.lastIndex = matchStart + innerLen;
    }
  }

  // 2. Color tags (Vietnamese and English, accented & unaccented)
  replaceTag(/\[(?:RED|ĐỎ|DO)\]([\s\S]*?)\[\/(?:RED|ĐỎ|DO)\]/i, [ZALO_STYLES.Bold, ZALO_STYLES.RubyRed]);
  replaceTag(/\[(?:GREEN|XANH)\]([\s\S]*?)\[\/(?:GREEN|XANH)\]/i, [ZALO_STYLES.Bold, ZALO_STYLES.EmeraldGreen]);
  replaceTag(/\[(?:ORANGE|CAM)\]([\s\S]*?)\[\/(?:ORANGE|CAM)\]/i, [ZALO_STYLES.Bold, ZALO_STYLES.AmberOrange]);
  replaceTag(/\[(?:YELLOW|VÀNG|VANG)\]([\s\S]*?)\[\/(?:YELLOW|VÀNG|VANG)\]/i, [ZALO_STYLES.Bold, ZALO_STYLES.RoyalGold]);

  // 3. Inline markdown tags
  replaceTag(/\*\*([\s\S]*?)\*\*/g, [ZALO_STYLES.Bold]);
  replaceTag(/__([\s\S]*?)__/g, [ZALO_STYLES.Underline]);
  replaceTag(/~~([\s\S]*?)~~/g, [ZALO_STYLES.StrikeThrough]);
  replaceTag(/\*([\s\S]*?)\*/g, [ZALO_STYLES.Italic]);

  return { text, styles };
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
