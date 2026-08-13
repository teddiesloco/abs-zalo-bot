import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_FILE = path.join(ROOT, "brand.json");

const DEFAULT_BRAND = Object.freeze({
  brand: "Agent Business System",
  short_name: "ABS",
  product: "ABS Zalo Bridge",
  product_line: "ABS Channel Intelligence",
  version: "0.2.0",
  publisher: "Agent Business System contributors",
  license: "MIT",
  website: "https://example.com/abs",
  repository: "https://github.com/example/abs-zalo-bridge",
  watermark: "ABS · Agent Business System",
  description: "A fail-closed Zalo channel bridge with separate Personal QR and official OA boundaries.",
});

function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function loadBrandFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BRAND_FILE, "utf8"));
    return { ...DEFAULT_BRAND, ...parsed };
  } catch {
    return { ...DEFAULT_BRAND };
  }
}

const loaded = loadBrandFile();

export const BRAND = Object.freeze({
  brand: clean(loaded.brand, DEFAULT_BRAND.brand),
  short_name: clean(loaded.short_name, DEFAULT_BRAND.short_name),
  product: clean(loaded.product, DEFAULT_BRAND.product),
  product_line: clean(loaded.product_line, DEFAULT_BRAND.product_line),
  version: clean(loaded.version, DEFAULT_BRAND.version),
  publisher: clean(loaded.publisher, DEFAULT_BRAND.publisher),
  license: clean(loaded.license, DEFAULT_BRAND.license),
  website: clean(loaded.website, DEFAULT_BRAND.website),
  repository: clean(loaded.repository, DEFAULT_BRAND.repository),
  watermark: clean(loaded.watermark, DEFAULT_BRAND.watermark),
  description: clean(loaded.description, DEFAULT_BRAND.description),
});

/**
 * Public machine-readable metadata. Deliberately contains no account,
 * destination, credential, session, or runtime state.
 */
export function publicBrandMetadata() {
  return { ...BRAND };
}

/**
 * Small visible mark for local dashboard surfaces and CLI headings.
 * Outbound Zalo content must not call this helper unless the operator has
 * explicitly enabled a customer-facing brand footer in that workflow.
 */
export function brandMark() {
  return BRAND.watermark;
}
