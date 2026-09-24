import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, mergeHermesConfig } from "../scripts/hermes-install-lib.js";

test("hermes install lib parses CLI options cleanly", () => {
  const parsed = parseCliArgs(["--hermes-home", "/root/.hermes", "--skip-python"]);
  assert.equal(parsed.hermesHome, "/root/.hermes");
  assert.equal(parsed.skipPython, true);
});

test("hermes config merger idempotently registers platform and tools without corrupting yaml", () => {
  const initialYaml = `plugins:\n  enabled:\n    - telegram\n`;
  const merged = mergeHermesConfig(initialYaml, { bridgeToken: "test-token-123" });
  assert.match(merged, /platforms\/zalo/);
  assert.match(merged, /zalo-tools/);
  assert.match(merged, /known_plugin_toolsets/);
  assert.match(merged, /zalo_owner/);
  assert.match(merged, /zalo_public/);

  // Second pass should produce identical content (idempotency)
  const secondPass = mergeHermesConfig(merged, { bridgeToken: "test-token-123" });
  assert.equal(secondPass, merged);
});
