// Privacy helpers: redaction before Hermes/report; raw retention optional.
const PHONE_RE = /(?:\+?84|0)\d{8,10}\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_RE = /(cookie|imei|password|api[_-]?key|authorization\s*:\s*bearer|session[_-]?token)/i;

export function hashSender(senderId, salt = process.env.HERMES_ZALO_PSEUDONYM_SALT || "local-only") {
  // lazy import-free hash via WebCrypto-less sha256 from schema
  return null; // filled by callers using sha256 from schema to keep one hash util
}

export function redactPII(text, { phones = true, emails = true } = {}) {
  let out = String(text ?? "");
  if (phones) out = out.replace(PHONE_RE, "[phone]");
  if (emails) out = out.replace(EMAIL_RE, "[email]");
  return out;
}

export function containsSecretPattern(text) {
  return SECRET_RE.test(String(text ?? ""));
}

export function sanitizeForHermes(text, opts = {}) {
  const redacted = redactPII(text, opts);
  if (containsSecretPattern(redacted)) {
    return { ok: false, text: "", reason: "secret_pattern" };
  }
  return { ok: true, text: redacted.slice(0, 2000) };
}

export function stripSensitiveMetadata(meta = {}) {
  const out = { ...meta };
  for (const k of Object.keys(out)) {
    if (/cookie|imei|token|password|session|secret|authorization/i.test(k)) {
      delete out[k];
    }
  }
  return out;
}
