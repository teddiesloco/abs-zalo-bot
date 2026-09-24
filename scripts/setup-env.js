import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

function closingQuote(value, quote) {
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === quote && !escaped) return true;
    escaped = char === '\\' && !escaped;
    if (char !== '\\') escaped = false;
  }
  return false;
}

/** Nạp .env như Node 22 nhưng từ chối dòng bị bỏ qua âm thầm. */
export function loadRepoEnv(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let openQuote = null;
  let quoteStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].trim();
    if (openQuote) {
      if (closingQuote(` ${text}`, openQuote)) openQuote = null;
      continue;
    }
    if (!text || text.startsWith('#')) continue;
    const match = text.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
    if (!match) throw new Error(`.env không hợp lệ ở dòng ${index + 1}`);
    const value = match[1];
    if ((value.startsWith('"') || value.startsWith("'")) && !closingQuote(value, value[0])) {
      openQuote = value[0];
      quoteStart = index + 1;
    }
  }
  if (openQuote) throw new Error(`.env không hợp lệ: chuỗi mở ở dòng ${quoteStart} chưa đóng`);

  for (const k in process.env) {
    if (process.env[k] === '') delete process.env[k];
  }

  loadEnvFile(path);
}

/**
 * Nạp .env của Hermes (nơi khách đặt ZALO_ALLOWED_USERS, EXA_API_KEY, FB_PAGES_FILE...)
 * dựa trên HERMES_HOME đã có trong process.env (install-hermes.js ghi cứng giá trị này
 * vào .env của sidecar lúc cài, nên chỉ cần nạp .env sidecar trước là biết được).
 * Biến môi trường đã tồn tại không bị ghi đè — đây là hành vi mặc định của loadEnvFile.
 */
export function loadHermesEnv({ env = process.env, warn = (message) => console.warn(message) } = {}) {
  const hermesHome = env.HERMES_HOME;
  if (!hermesHome) {
    warn('[env] Không tìm thấy HERMES_HOME — bỏ qua nạp .env của Hermes; ZALO_ALLOWED_USERS, EXA_API_KEY, FB_PAGES_FILE... có thể không được đọc.');
    return { loaded: false, path: null };
  }
  const path = join(hermesHome, '.env');
  try {
    loadEnvFile(path);
    return { loaded: true, path };
  } catch (error) {
    if (error?.code === 'ENOENT') return { loaded: false, path };
    throw error;
  }
}
