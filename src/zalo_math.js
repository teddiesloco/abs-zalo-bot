/**
 * ABS Zalo Math & LaTeX to Unicode Converter
 *
 * Converts LaTeX formulas in agent messages to native Unicode symbols:
 * "$Ca^{2+}$" -> "Ca²⁺", "\rightarrow" -> "→", "\alpha" -> "α", "$x^2$" -> "x²", "H_2O" -> "H₂O"
 * Preserves backticks `code`, code blocks ```, and URLs untouched.
 */

const SUPERSCRIPT = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ',
  l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ',
  x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};

const SUBSCRIPT = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ',
  r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

const SYMBOLS = {
  // Mũi tên & suy luận
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', implies: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔',
  longrightarrow: '⟶', longleftarrow: '⟵', rightleftharpoons: '⇌', uparrow: '↑', downarrow: '↓',
  // So sánh & toán tử
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', pm: '±', mp: '∓', approx: '≈',
  sim: '∼', simeq: '≃', equiv: '≡', propto: '∝', times: '×', div: '÷', cdot: '·', ast: '∗',
  ll: '≪', gg: '≫', infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫',
  quad: '   ', qquad: '      ',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', emptyset: '∅', varnothing: '∅', therefore: '∴', because: '∵',
  angle: '∠', perp: '⊥', parallel: '∥', degree: '°', circ: '°', prime: '′',
  ldots: '…', dots: '…', cdots: '⋯',
  // Hy Lạp
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const LETTER_LIKE = new Set([
  ...Object.keys(SYMBOLS).filter((name) => /^[\p{Script=Greek}]+$/u.test(SYMBOLS[name])),
  'partial', 'nabla', 'infty',
]);

const SYMBOL_RE = /\\([A-Za-z]+)(?![A-Za-z])/g;

function script(content, table, marker) {
  const chars = [...content];
  if (chars.length && chars.every((ch) => table[ch] !== undefined)) {
    return chars.map((ch) => table[ch]).join('');
  }
  return chars.length > 1 ? `${marker}(${content})` : `${marker}${content}`;
}

function replaceSymbols(text) {
  return text.replace(SYMBOL_RE, (match, name) => SYMBOLS[name] ?? match);
}

function wrap(part) {
  return /^[\p{L}\p{N}.,²³⁺⁻₀-₉⁰-⁹]+$/u.test(part) ? part : `(${part})`;
}

/** Đổi phần bên trong một công thức (đã bỏ dấu $ / \( \)). */
function convertMath(expr) {
  let out = expr;
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit|textbf|textit|operatorname|mbox)\{([^{}]*)\}/g, '$1');
  out = out.replace(/\\(?:left|right)(?![A-Za-z])\s*/g, '');
  out = out.replace(/\\[,;:!]|\\q?quad/g, ' ');
  out = out.replace(/\^\{?\\circ\}?/g, '°');
  for (let previous = ''; previous !== out;) {
    previous = out;
    out = out.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${wrap(a)}/${wrap(b)}`);
    out = out.replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√${wrap(a)}`);
  }
  out = out.replace(/\\sqrt\s*(\S)/g, '√$1');
  out = out.replace(/\\([A-Za-z]+) (?=[\p{L}\p{N}])/gu, (match, name) => (
    LETTER_LIKE.has(name) ? SYMBOLS[name] : match));
  out = replaceSymbols(out);
  out = out.replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, group, single) => script(group ?? single, SUPERSCRIPT, '^'));
  out = out.replace(/_\{([^{}]*)\}|_(\S)/g, (_, group, single) => script(group ?? single, SUBSCRIPT, '_'));
  return out.replace(/[{}]/g, '');
}

function looksLikeMath(inner) {
  return /[\\^_{}]/.test(inner) || /^[A-Za-z]$/.test(inner);
}

/** Phần chữ thường (không phải mã): công thức có dấu bao, lệnh trần, mũ/chỉ số trần. */
function convertProse(text) {
  let out = text;
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => convertMath(inner.trim()));
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => convertMath(inner.trim()));
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => convertMath(inner.trim()));
  out = out.replace(/\$(?!\s)([^$\n]*?[^\s$])\$/g, (match, inner) => (looksLikeMath(inner) ? convertMath(inner) : match));
  out = replaceSymbols(out);
  // H_2O, CO_2, SO_{4}: sau ký hiệu hoá học viết hoa, cho phép tiếp theo là chữ in hoa (O trong H_2O) hoặc hết từ, tránh snake_case như file_2.
  out = out.replace(/(?<=(?:^|[^\p{L}\p{N}_])(?:[A-Z][a-z]?)+)_(\{[^{}\s]*\}|\d+)(?![a-z_])/gu, (_, part) => (
    script(part.replace(/^\{|\}$/g, ''), SUBSCRIPT, '_')));
  out = out.replace(/(?<=[\p{L}\p{N})])\^(\{[^{}\s]*\}|[+\-−]|\d+)/gu, (_, part) => (
    script(part.replace(/^\{|\}$/g, ''), SUPERSCRIPT, '^')));
  return out;
}

/**
 * @param {string} text Chữ bot định gửi (Markdown, chưa dịch sang style Zalo).
 * @returns {string} Chữ đã đổi công thức LaTeX sang Unicode; mã trong `…` và link giữ nguyên.
 */
export function latexToUnicode(text) {
  const source = String(text ?? '');
  if (!/[\\$^_]/.test(source)) return source;
  return source
    .split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+)/)
    .map((part, index) => (index % 2 === 1 ? part : convertProse(part)))
    .join('');
}
