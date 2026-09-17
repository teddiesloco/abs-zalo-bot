import test from "node:test";
import assert from "node:assert/strict";
import { latexToUnicode } from "../src/zalo_math.js";

test("latexToUnicode converts common chemical formulas and math exponents", () => {
  assert.equal(latexToUnicode("H_2O"), "H₂O");
  assert.equal(latexToUnicode("CO_2"), "CO₂");
  assert.equal(latexToUnicode("x^2 + y^2 = z^2"), "x² + y² = z²");
  assert.equal(latexToUnicode("$Ca^{2+}$"), "Ca²⁺");
});

test("latexToUnicode converts LaTeX symbols to Unicode", () => {
  assert.equal(latexToUnicode("\\alpha + \\beta = \\gamma"), "α + β = γ");
  assert.equal(latexToUnicode("A \\rightarrow B"), "A → B");
  assert.equal(latexToUnicode("x \\le 10 \\quad y \\ge 20"), "x ≤ 10     y ≥ 20");
});

test("latexToUnicode preserves code blocks and URLs", () => {
  assert.equal(latexToUnicode("`x_1 = foo`"), "`x_1 = foo`");
  assert.equal(latexToUnicode("https://example.com/api?val=a^2"), "https://example.com/api?val=a^2");
});
