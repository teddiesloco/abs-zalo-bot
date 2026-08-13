import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordZaloBrainTurn } from "../src/abs_telemetry.js";

// Duong dan ledger la cau hinh; repo public khong hardcode duong dan may chu nao.
const ledgerStub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "abs-ledger-")), "ledger.py");
fs.writeFileSync(ledgerStub, "# stub ledger cho kiem thu\n");
process.env.ABS_LEDGER_PATH = ledgerStub;

test("ABS Zalo adapter keeps raw source and content out of process arguments", () => {
  const calls = [];
  const result = recordZaloBrainTurn({
    event: {
      source_id: "private-zalo-source-id",
      source_type: "group",
      text: "this private text must never enter telemetry",
      sender_id: "private-sender-id",
    },
    outcome: "success",
    durationMs: 1200,
    runner: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0 };
    },
  });
  assert.deepEqual(result, { ok: true, reason: "recorded" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "python3");
  assert.equal(calls[0].args.at(-1), "record-stdin");
  assert.match(calls[0].input, /zalo_brain_turn/);
  assert.match(calls[0].input, /private-zalo-source-id/); // transient stdin only
  assert.doesNotMatch(calls[0].input, /private text|private-sender-id/);
  assert.doesNotMatch(calls[0].args.join(" "), /private-zalo-source-id|private text|private-sender-id/);
});

test("ABS Zalo adapter is fail-open when no ledger is available", () => {
  const result = recordZaloBrainTurn({
    event: { source_id: "", source_type: "group" },
    runner: () => {
      throw new Error("must not run");
    },
  });
  assert.deepEqual(result, { ok: false, reason: "telemetry_unavailable" });
});
