/**
 * ABS Zalo Token Bucket Rate Limiter
 *
 * Smooths outbound messages using a token bucket algorithm to prevent
 * triggering Zalo anti-spam / checkpoint mechanisms while keeping real-time
 * conversational responses instantaneous (zero delay for the first burst).
 */

export class RateLimitedError extends Error {
  constructor(waitMs) {
    super(
      `Đang bị giãn nhịp chống spam Zalo, cần chờ ~${Math.ceil(waitMs / 1000)}s. ` +
        `Vui lòng gửi ít tin hơn hoặc thử lại sau.`
    );
    this.name = "RateLimitedError";
    this.waitMs = waitMs;
  }
}

export class RateLimiter {
  #tokens;
  #capacity;
  #refillMs;
  #maxWaitMs;
  #last;
  #hi = [];
  #lo = [];
  #timer = null;

  /**
   * @param {object} opts
   * @param {number} opts.capacity  Burst capacity (default 5: burst of 5 messages with 0 delay).
   * @param {number} opts.refillMs  Token regeneration time (default 3000ms = sustainable 20 msg/min).
   * @param {number} opts.maxWaitMs Max wait before rejecting with RateLimitedError (default 20000ms).
   */
  constructor({ capacity = 5, refillMs = 3000, maxWaitMs = 20000 } = {}) {
    this.#capacity = Math.max(1, capacity);
    this.#refillMs = Math.max(1, refillMs);
    this.#maxWaitMs = Math.max(0, maxWaitMs);
    this.#tokens = this.#capacity;
    this.#last = Date.now();
  }

  get queued() {
    return this.#hi.length + this.#lo.length;
  }

  get available() {
    this.#refill();
    return Math.floor(this.#tokens);
  }

  #refill() {
    const now = Date.now();
    const gained = (now - this.#last) / this.#refillMs;
    if (gained <= 0) return;
    this.#tokens = Math.min(this.#capacity, this.#tokens + gained);
    this.#last = now;
  }

  /**
   * Acquire a rate limit slot.
   *
   * @param {'high'|'normal'} priority 'high' for immediate conversational replies, 'normal' for bulk/sync.
   * @returns {Promise<void>} Resolves when granted permission to send.
   * @throws {RateLimitedError} When queue wait time exceeds maxWaitMs.
   */
  acquire(priority = "normal") {
    this.#refill();

    // Fast path: tokens available and no existing queue -> immediate dispatch (0 latency)
    if (this.queued === 0 && this.#tokens >= 1) {
      this.#tokens -= 1;
      return Promise.resolve();
    }

    const ahead = priority === "high" ? this.#hi.length : this.queued;
    const waitMs = Math.max(0, Math.ceil((ahead + 1 - this.#tokens) * this.#refillMs));
    if (waitMs > this.#maxWaitMs) {
      return Promise.reject(new RateLimitedError(waitMs));
    }

    return new Promise((resolve) => {
      (priority === "high" ? this.#hi : this.#lo).push(resolve);
      this.#schedule();
    });
  }

  #schedule() {
    if (this.#timer) return;
    const tick = () => {
      this.#timer = null;
      this.#refill();
      while (this.#tokens >= 1 && this.queued > 0) {
        const next = this.#hi.shift() ?? this.#lo.shift();
        this.#tokens -= 1;
        next();
      }
      if (this.queued > 0) {
        const need = Math.ceil((1 - this.#tokens) * this.#refillMs);
        this.#timer = setTimeout(tick, Math.max(25, need));
      }
    };
    this.#timer = setTimeout(tick, 25);
  }

  /** Stop active timers to permit clean process termination. */
  stop() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    while (this.#hi.length > 0) {
      const resolve = this.#hi.shift();
      resolve();
    }
    while (this.#lo.length > 0) {
      const resolve = this.#lo.shift();
      resolve();
    }
  }
}

/** Methods subject to rate throttling */
export const THROTTLED_METHODS = new Set([
  "sendMessage",
  "sendVoice",
  "sendVideo",
  "sendSticker",
  "sendLink",
  "sendCard",
  "uploadAttachment",
  "forwardMessage",
  "createPoll",
  "createNote",
  "createReminder",
  "addUserToGroup",
  "inviteUserToGroups",
]);
