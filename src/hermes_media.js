// Safe media staging for the external Hermes bridge. Provider URLs are never
// persisted or returned to the model; only opaque, local attachment refs are.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";

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
    const url = [
      value.href, value.url, value.fileUrl, value.downloadUrl, value.voiceUrl, value.videoUrl,
      value.oriUrl, value.hdUrl, value.normalUrl, value.thumb, value.thumbUrl, value.previewThumb, value.rawUrl,
    ].find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
    if (url && !seen.has(url)) {
      seen.add(url);
      const name = safeName(value.fileName || value.name || value.title || path.basename(new URL(url).pathname), "attachment");
      const raw = `${value.type || ""} ${value.action || ""} ${name} ${new URL(url).hostname}`.toLowerCase();
      const kind = /video|\.(?:mp4|mov|webm)$/u.test(raw) ? "video" : /voice|audio|\.(?:mp3|m4a|wav|aac)$/u.test(raw) ? "audio" : /photo|image|thumb|\.(?:jpe?g|png|webp|gif)$/u.test(raw) ? "image" : "file";
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
      const ext = path.extname(candidate.name) || (candidate.kind === "image" ? ".jpg" : candidate.kind === "audio" ? ".m4a" : candidate.kind === "video" ? ".mp4" : "");
      const baseCandidateName = safeName(candidate.name, "attachment");
      const candidateNameWithExt = ext && !baseCandidateName.toLowerCase().endsWith(ext) ? `${baseCandidateName}${ext}` : baseCandidateName;
      const relative = path.join("media", event.event_id, `${id}-${candidateNameWithExt}`);
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
      refs.push({ id, path: relative, name: candidateNameWithExt, kind: candidate.kind, mime: response.headers.get("content-type")?.split(";")[0] || extensionMime(candidateNameWithExt, candidate.kind), size: bytes });
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

/**
 * Đóng gói âm thanh thành M4A (AAC mono 44.1 kHz, 64k) với cờ +faststart
 * để iPhone (AVPlayer) và Zalo PC (Chromium) phát mượt mà.
 */
export function transcodeToM4a(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) return null;
  const ffmpeg = "ffmpeg";
  const outputPath = path.join(os.tmpdir(), `zalo_voice_${crypto.randomBytes(6).toString("hex")}.m4a`);
  try {
    const res = spawnSync(
      ffmpeg,
      [
        "-v", "error", "-y", "-i", audioPath,
        "-vn", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 60000 }
    );
    if (res.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return outputPath;
    }
  } catch {
    /* ffmpeg failed or not found */
  }
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Nối đuôi tệp (.m4a) vào link CDN Zalo nếu chưa có đuôi âm thanh.
 * Zalo CDN bỏ qua đuôi này và trả đúng tệp, giúp iOS/PC detect MIME chuẩn.
 */
export function withAudioExtension(url, extension = ".m4a") {
  if (!url || typeof url !== "string") return url;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    if (/\.(m4a|aac|mp3|wav|ogg)$/i.test(pathname)) {
      return url;
    }
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    parsed.pathname = `${pathname}${ext}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Guard chống gửi lặp tin thoại vào cùng một chat trong cửa sổ thời gian (mặc định 10 phút).
 */
export function createVoiceDedupGuard({ windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const sentVoices = new Map();
  return {
    isDuplicate(chatId, filePath) {
      if (!filePath || !fs.existsSync(filePath)) return false;
      const currentTime = now();
      for (const [k, v] of sentVoices.entries()) {
        if (currentTime - v.at > windowMs) sentVoices.delete(k);
      }
      try {
        const stat = fs.statSync(filePath);
        const key = `${chatId}:${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}`;
        return sentVoices.has(key);
      } catch {
        return false;
      }
    },
    record(chatId, filePath, result = { ok: true }) {
      if (!filePath || !fs.existsSync(filePath)) return;
      try {
        const stat = fs.statSync(filePath);
        const key = `${chatId}:${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}`;
        sentVoices.set(key, { at: now(), result });
      } catch {
        /* ignore */
      }
    },
    get(chatId, filePath) {
      try {
        const stat = fs.statSync(filePath);
        const key = `${chatId}:${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}`;
        return sentVoices.get(key)?.result || null;
      } catch {
        return null;
      }
    },
    clear() {
      sentVoices.clear();
    },
  };
}

