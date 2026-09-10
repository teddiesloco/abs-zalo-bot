import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, RateLimitedError, THROTTLED_METHODS } from "../src/rate_limiter.js";

test("ABS Zalo Token Bucket Rate Limiter", async (t) => {
  await t.test("allows burst of initial tokens with zero delay", async () => {
    const limiter = new RateLimiter({ capacity: 3, refillMs: 500, maxWaitMs: 2000 });
    assert.equal(limiter.available, 3);

    // Consume 3 tokens immediately
    await limiter.acquire("normal");
    await limiter.acquire("normal");
    await limiter.acquire("normal");

    assert.equal(limiter.available, 0);
    limiter.stop();
  });

  await t.test("prioritizes high priority replies over normal queue", async () => {
    const limiter = new RateLimiter({ capacity: 1, refillMs: 50, maxWaitMs: 2000 });
    await limiter.acquire("normal"); // consume initial token

    const order = [];
    const p1 = limiter.acquire("normal").then(() => order.push("normal_1"));
    const p2 = limiter.acquire("normal").then(() => order.push("normal_2"));
    const pHigh = limiter.acquire("high").then(() => order.push("high_priority"));

    await Promise.all([p1, p2, pHigh]);
    assert.equal(order[0], "high_priority", "High priority request should jump the queue");
    limiter.stop();
  });

  await t.test("rejects when estimated wait exceeds maxWaitMs", async () => {
    const limiter = new RateLimiter({ capacity: 1, refillMs: 1000, maxWaitMs: 1500 });
    await limiter.acquire("normal"); // 0 token left

    // Next request takes 1000ms (<= 1500ms -> allowed in queue)
    const p1 = limiter.acquire("normal");

    // Second request would take 2000ms (> 1500ms -> rejected immediately)
    await assert.rejects(
      async () => {
        await limiter.acquire("normal");
      },
      RateLimitedError
    );

    limiter.stop();
    await p1;
  });

  await t.test("THROTTLED_METHODS covers critical outbound calls", () => {
    assert.ok(THROTTLED_METHODS.has("sendMessage"));
    assert.ok(THROTTLED_METHODS.has("sendVoice"));
    assert.ok(THROTTLED_METHODS.has("createPoll"));
    assert.ok(THROTTLED_METHODS.has("addUserToGroup"));
  });
});
