import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * anyone running this fork should be able to present it as their own tool.
 */
function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

const pkg = readPackage();

export const serviceMetadata = Object.freeze({
  name: pkg.name || "abs-zalo-bot",
  version: pkg.version || "0.0.0",
  license: pkg.license || "MIT",
});

/** Kept for backward compatibility with existing imports. */
export function publicBrandMetadata() {
  return { ...serviceMetadata };
}

export default serviceMetadata;
