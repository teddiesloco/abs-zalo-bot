// Safe media staging for the external Hermes bridge. Provider URLs are never
// persisted or returned to the model; only opaque, local attachment refs are.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_IMAGE_OR_FILE = 25 * 1024 * 1024;
const MAX_AUDIO_OR_VIDEO = 100 * 1024 * 1024;
const ALLOWED_HOST = /(^|\.)(zalo\.me|zaloapp\.com|zadn\.vn|zdn\.vn|zalo\.cloud|zaloapi\.com|dlmd\.me)$/i;
const VIDEO_STAL_HOST = /^(video|dfile|file|photo)-stal-\d+\.dlmd\.me$/i;

function safeName(value, fallback) {
  const name = path.basename(String(value || "").replace(/[^\w. -]/g, "_")).slice(0, 120);
  return name || fallback;
}

function extensionMime(name, kind) {
  const ext = path.extname(String(name || "")).toLowerCase();
  const known = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain" };
  return known[ext] || (kind === "image" ? "image/*" : kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "application/octet-stream");
}

export function extractAttachmentCandidates(content) {
  if (!content || typeof content !== "object") return [];
  const seen = new Set();
  const results = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 5 || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    const url = [value.href, value.url, value.fileUrl, value.downloadUrl, value.voiceUrl, value.videoUrl]
      .find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
    if (url && !seen.has(url)) {
      seen.add(url);
      const name = safeName(value.fileName || value.name || value.title || path.basename(new URL(url).pathname), "attachment");
      const raw = `${value.type || ""} ${value.action || ""} ${name}`.toLowerCase();
      const kind = /video/.test(raw) ? "video" : /voice|audio/.test(raw) ? "audio" : /photo|image|thumb/.test(raw) ? "image" : "file";
      results.push({ url, name, kind });
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(content);
  return results.slice(0, 4);
}

export function assertZaloAttachmentUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || !url.hostname || !(ALLOWED_HOST.test(url.hostname) || VIDEO_STAL_HOST.test(url.hostname))) {
    throw new Error("attachment_url_not_allowed");
  }
  return url;
}

export async function stageHermesMedia(event, { dataDir, fetchImpl = globalThis.fetch } = {}) {
  const candidates = Array.isArray(event.attachment_candidates) ? event.attachment_candidates : [];
  delete event.attachment_candidates;
  if (process.env.HERMES_ZALO_MEDIA_INGEST !== "true" || !candidates.length) return event;
  const refs = [];
  for (const candidate of candidates) {
    try {
      const url = assertZaloAttachmentUrl(candidate.url);
      const limit = ["audio", "video"].includes(candidate.kind) ? MAX_AUDIO_OR_VIDEO : MAX_IMAGE_OR_FILE;
      const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
      if (!response.ok || !response.body) throw new Error("attachment_download_failed");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > limit) throw new Error("attachment_too_large");
      const id = crypto.createHash("sha256").update(`${event.event_id}|${candidate.url}`).digest("hex").slice(0, 24);
      const relative = path.join("media", event.event_id, `${id}-${safeName(candidate.name, "attachment")}`);
      const full = path.resolve(dataDir, relative);
      if (!full.startsWith(`${path.resolve(dataDir, "media")}${path.sep}`)) throw new Error("attachment_path_invalid");
      fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
      const output = fs.createWriteStream(full, { mode: 0o600, flags: "w" });
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > limit) throw new Error("attachment_too_large");
          if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
        }
      } finally {
        output.end();
        await new Promise((resolve, reject) => {
          output.once("finish", resolve);
          output.once("error", reject);
        });
      }
      if (!bytes) throw new Error("attachment_empty");
      refs.push({ id, path: relative, name: safeName(candidate.name, "attachment"), kind: candidate.kind, mime: response.headers.get("content-type")?.split(";")[0] || extensionMime(candidate.name, candidate.kind), size: bytes });
    } catch (err) {
      refs.push({ id: crypto.randomUUID(), name: safeName(candidate.name, "attachment"), kind: candidate.kind || "file", status: "unavailable", error: String(err?.message || err).slice(0, 80) });
    }
  }
  event.raw_metadata = { ...(event.raw_metadata || {}), hermes_media: refs };
  return event;
}

export function resolveStagedMedia(dataDir, eventId, attachmentId, metadata) {
  const refs = Array.isArray(metadata?.hermes_media) ? metadata.hermes_media : [];
  const ref = refs.find((item) => item?.id === String(attachmentId) && item?.path);
  if (!ref || String(eventId) !== String(metadata?.event_id || eventId)) return null;
  const full = path.resolve(dataDir, ref.path);
  const root = path.resolve(dataDir, "media");
  if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return null;
  return { ...ref, full };
}
