import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync,
  renameSync, rmSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMap, isSeq, parse, parseDocument } from 'yaml';

const PLATFORM_KEY = 'platforms/zalo';
const TOOLS_KEY = 'zalo-tools';

export function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--hermes-home') options.hermesHome = argv[++index];
    else if (value === '--sidecar-root') options.sidecarRoot = argv[++index];
    else if (value === '--skip-python') options.skipPython = true;
    else throw new Error(`Tham số không hỗ trợ: ${value}`);
  }
  if (!options.sidecarRoot) options.sidecarRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  return options;
}

function isHermesRepo(path) {
  return existsSync(join(path, 'plugins'))
    && existsSync(join(path, 'gateway'))
    && existsSync(join(path, 'pyproject.toml'));
}

function layoutFromCandidate(candidate) {
  const absolute = resolve(candidate);
  if (isHermesRepo(absolute)) {
    const parentConfig = join(dirname(absolute), 'config.yaml');
    return {
      home: existsSync(parentConfig) ? dirname(absolute) : absolute,
      repoRoot: absolute,
      configPath: existsSync(parentConfig) ? parentConfig : join(absolute, 'config.yaml'),
    };
  }
  const nested = join(absolute, 'hermes-agent');
  if (isHermesRepo(nested)) {
    return { home: absolute, repoRoot: nested, configPath: join(absolute, 'config.yaml') };
  }
  return null;
}

export function resolveHermesLayout({ hermesHome = null, env = process.env, cwd = process.cwd() } = {}) {
  const explicit = hermesHome || env.HERMES_HOME;
  if (explicit && explicit.length > 0) {
    const layout = layoutFromCandidate(explicit);
    if (layout) return layout;
    throw new Error(`Không tìm thấy Hermes Agent hợp lệ tại: ${resolve(explicit)}`);
  }

  const candidates = [cwd, dirname(cwd), join(homedir(), '.hermes')];
  if (platform() === 'win32' && env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'hermes'));
  for (const candidate of candidates) {
    const layout = layoutFromCandidate(candidate);
    if (layout) return layout;
  }
  throw new Error('Không tự tìm thấy Hermes Agent; hãy truyền --hermes-home <đường-dẫn>');
}

export function mergeHermesConfig(text, { bridgeToken, styleGuide = null } = {}) {
  // Sửa ngay trên Document chứ không parse ra object rồi stringify lại: cách cũ
  // làm mất sạch comment của khách và làm tròn số nguyên lớn (ID kênh 19 chữ số
  // thành một số khác, trỏ sai kênh). intAsBigInt giữ nguyên từng chữ số.
  const doc = parseDocument(text || '', { intAsBigInt: true });
  if (doc.errors.length) throw doc.errors[0];
  if (doc.contents == null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) {
    throw new Error('config.yaml phải chứa một YAML mapping ở cấp cao nhất');
  }

  const ensureMap = (path) => {
    for (let depth = 1; depth <= path.length; depth += 1) {
      const sub = path.slice(0, depth);
      if (!isMap(doc.getIn(sub, true))) doc.setIn(sub, doc.createNode({}));
    }
  };
  const setDefault = (path, value) => {
    ensureMap(path.slice(0, -1));
    if (doc.getIn(path) === undefined) doc.setIn(path, value);
  };
  const setValue = (path, value) => {
    ensureMap(path.slice(0, -1));
    doc.setIn(path, value);
  };
  const ensureListItems = (path, names) => {
    ensureMap(path.slice(0, -1));
    if (!isSeq(doc.getIn(path, true))) doc.setIn(path, doc.createNode([]));
    const seq = doc.getIn(path, true);
    const present = seq.items.map((item) => String(item?.value ?? item));
    for (const name of names) if (!present.includes(name)) seq.add(name);
  };

  ensureListItems(['known_plugin_toolsets', 'zalo'], ['zalo_owner', 'zalo_public', 'zalo_cron']);
  setDefault(['group_sessions_per_user'], false);

  ensureListItems(['plugins', 'enabled'], [PLATFORM_KEY, TOOLS_KEY]);
  // Hook pre_tool_call chặn công cụ của người ngoài chạy đồng bộ. Để timeout
  // mặc định thì Hermes khoá callback dùng chung giữa mọi luồng: các lời gọi
  // công cụ song song bị chặn nhầm "still running" (đo được 286/320 lần).
  doc.setIn(['plugins', 'hook_callback_timeout'], 0);
  const disabled = doc.getIn(['plugins', 'disabled'], true);
  if (isSeq(disabled)) {
    disabled.items = disabled.items.filter((item) => ![PLATFORM_KEY, TOOLS_KEY].includes(String(item?.value ?? item)));
  }

  setDefault(['platforms', 'zalo', 'enabled'], true);
  setDefault(['platforms', 'zalo', 'extra', 'bridge_url'], 'ws://127.0.0.1:3873');
  setDefault(['platforms', 'zalo', 'extra', 'reply_only_tagged'], true);
  if (bridgeToken) setValue(['platforms', 'zalo', 'extra', 'bridge_token'], bridgeToken);

  if (styleGuide) {
    // Không đè: khách có thể đã tự viết giọng điệu riêng, chỉ ghi khi trống.
    const existingAppend = doc.getIn(['platform_hints', 'zalo', 'append']);
    if (typeof existingAppend !== 'string' || existingAppend.trim() === '') {
      setValue(['platform_hints', 'zalo', 'append'], styleGuide);
    }
  }

  const display = ['display', 'platforms', 'zalo'];
  setDefault([...display, 'tool_progress'], 'off');
  setDefault([...display, 'long_running_notifications'], false);
  setDefault([...display, 'busy_ack_detail'], false);
  setDefault([...display, 'show_reasoning'], false);
  setDefault([...display, 'streaming'], false);
  setDefault([...display, 'interim_assistant_messages'], false);

  return doc.toString({ lineWidth: 0 });
}

function quoteCommandPath(path) {
  const value = String(path);
  if (platform() === 'win32') return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderPlatformManifest(template, sidecarRoot) {
  const serverPath = join(resolve(sidecarRoot), 'server.js').replaceAll('\\', '/');
  return String(template).replaceAll('{{SIDECAR_SERVER}}', serverPath);
}

function within(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function atomicReplaceDirectory(source, destination) {
  const parent = dirname(destination);
  if (!within(parent, destination)) throw new Error(`Đích plugin không an toàn: ${destination}`);
  mkdirSync(parent, { recursive: true });
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const staging = join(parent, `.${destination.split(/[\\/]/).pop()}.install-${suffix}`);
  const backup = join(parent, `.${destination.split(/[\\/]/).pop()}.backup-${suffix}`);
  if (!within(parent, staging) || !within(parent, backup)) throw new Error('Đường dẫn staging không an toàn');
  cpSync(source, staging, { recursive: true, force: true });
  let movedOld = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      movedOld = true;
    }
    renameSync(staging, destination);
    if (movedOld) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (movedOld && !existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function atomicWriteText(destination, content) {
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const staging = join(parent, `.${destination.split(/[\\/]/).pop()}.install-${suffix}`);
  const backup = join(parent, `.${destination.split(/[\\/]/).pop()}.backup-${suffix}`);
  if (!within(parent, staging) || !within(parent, backup)) throw new Error('Đường dẫn ghi cấu hình không an toàn');
  writeFileSync(staging, content, 'utf8');
  let movedOld = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      movedOld = true;
    }
    renameSync(staging, destination);
    if (movedOld) rmSync(backup, { force: true });
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true });
    if (movedOld && !existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function readBridgeToken(envPath) {
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, 'utf8').match(/^ZALO_BRIDGE_TOKEN=(.+)$/m);
  return match?.[1]?.trim() || null;
}

function appendEnvValue(envPath, key, value) {
  const current = readFileSync(envPath, 'utf8');
  const hasKey = new RegExp(`^${key}=.+$`, 'm').test(current);
  if (hasKey) return;
  writeFileSync(envPath, `${current}${current.endsWith('\n') || !current ? '' : '\n'}${key}=${value}\n`, 'utf8');
}

/** Như appendEnvValue nhưng thay giá trị cũ nếu khác — dùng cho khoá do trình cài quản lý. */
function setEnvValue(envPath, key, value) {
  const current = readFileSync(envPath, 'utf8');
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (!pattern.test(current)) return appendEnvValue(envPath, key, value);
  const next = current.replace(pattern, `${key}=${value}`);
  if (next !== current) writeFileSync(envPath, next, 'utf8');
}

function ensureSidecarEnv(sidecarRoot, hermesHome) {
  const envPath = join(sidecarRoot, '.env');
  if (!existsSync(envPath)) {
    const examplePath = join(sidecarRoot, '.env.example');
    copyFileSync(examplePath, envPath);
  }
  let token = readBridgeToken(envPath);
  if (!token) {
    token = randomBytes(32).toString('hex');
    appendEnvValue(envPath, 'ZALO_BRIDGE_TOKEN', token);
  }
  // Thay chứ không chỉ thêm: lần cài trước dò nhầm nhà Hermes thì chạy lại với
  // --hermes-home đúng phải sửa được, không thì sidecar nạp nhầm .env mãi.
  setEnvValue(envPath, 'HERMES_HOME', resolve(hermesHome).replaceAll('\\', '/'));
  return token;
}

function pythonPath(repoRoot) {
  const candidates = platform() === 'win32'
    ? [join(repoRoot, 'venv', 'Scripts', 'python.exe'), join(repoRoot, '.venv', 'Scripts', 'python.exe')]
    : [join(repoRoot, 'venv', 'bin', 'python'), join(repoRoot, '.venv', 'bin', 'python')];
  return candidates.find(existsSync) || null;
}

function ensureWebsockets(repoRoot, hermesHome, { skipPython = false } = {}) {
  if (skipPython) return { skipped: true };
  const python = pythonPath(repoRoot);
  if (!python) throw new Error('Không tìm thấy Python venv của Hermes để cài websockets');
  let probe = spawnSync(python, ['-c', 'import websockets'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    const uv = platform() === 'win32'
      ? join(hermesHome, 'bin', 'uv.exe')
      : join(hermesHome, 'bin', 'uv');
    const install = existsSync(uv)
      ? spawnSync(uv, ['pip', 'install', '--python', python, 'websockets'], { encoding: 'utf8' })
      : spawnSync(python, ['-m', 'pip', 'install', 'websockets'], { encoding: 'utf8' });
    if (install.status !== 0) throw new Error(`Không cài được websockets: ${install.stderr || install.stdout}`);
    probe = spawnSync(python, ['-c', 'import websockets'], { encoding: 'utf8' });
  }
  if (probe.status !== 0) throw new Error('Python của Hermes chưa import được websockets');
  return { python };
}

/**
 * Cài bộ giải mã JPEG XL cho ảnh Zalo. Không có thì bot vẫn chạy, chỉ báo với
 * người gửi là chưa đọc được ảnh dạng đó — nên hỏng ở đây không chặn cài đặt.
 */
function ensureJxlDecoder(repoRoot, hermesHome, { skipPython = false } = {}) {
  if (skipPython) return { skipped: true };
  const python = pythonPath(repoRoot);
  if (!python) return { skipped: true };
  if (spawnSync(python, ['-c', 'import pillow_jxl'], { encoding: 'utf8' }).status === 0) return { python };
  const uv = join(hermesHome, 'bin', platform() === 'win32' ? 'uv.exe' : 'uv');
  const install = existsSync(uv)
    ? spawnSync(uv, ['pip', 'install', '--python', python, 'pillow-jxl-plugin'], { encoding: 'utf8' })
    : spawnSync(python, ['-m', 'pip', 'install', 'pillow-jxl-plugin'], { encoding: 'utf8' });
  return { python, ok: install.status === 0 };
}

function styleGuidePath(sidecarRoot) {
  return join(resolve(sidecarRoot), 'hermes-plugin', 'zalo-style-guide.md');
}

function readStyleGuide(sidecarRoot) {
  const source = styleGuidePath(sidecarRoot);
  if (!existsSync(source)) throw new Error(`Thiếu hướng dẫn trình bày Zalo trong bộ cài: ${source}`);
  return readFileSync(source, 'utf8').trim();
}

function configObject(configPath) {
  try { return parse(readFileSync(configPath, 'utf8')) || {}; } catch { return null; }
}

export function doctorHermes({
  sidecarRoot,
  hermesHome,
  skipPython = false,
  commandProbe = spawnSync,
} = {}) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  let layout;
  try {
    layout = resolveHermesLayout({ hermesHome });
    add('hermes-layout', true, layout.repoRoot);
  } catch (error) {
    add('hermes-layout', false, error.message);
    return { ok: false, checks };
  }
  const root = resolve(sidecarRoot || fileURLToPath(new URL('..', import.meta.url)));
  const platformDir = join(layout.repoRoot, 'plugins', 'platforms', 'zalo');
  const toolsDir = join(layout.repoRoot, 'plugins', 'zalo_tools');
  add('zalo-platform', existsSync(join(platformDir, 'adapter.py')));
  add('zalo-tools', existsSync(join(toolsDir, 'tools.py')));
  const manifestPath = join(platformDir, 'plugin.yaml');
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
  add('portable-manifest', Boolean(manifest) && !manifest.includes('{{SIDECAR_SERVER}}') && manifest.includes('server.js'));
  const config = configObject(layout.configPath);
  const enabled = config?.plugins?.enabled || [];
  const known = config?.known_plugin_toolsets?.zalo || [];
  add('config', Boolean(config) && enabled.includes(PLATFORM_KEY) && enabled.includes(TOOLS_KEY)
    && known.includes('zalo_owner') && known.includes('zalo_public') && known.includes('zalo_cron'));
  const configuredAppend = config?.platform_hints?.zalo?.append;
  const hasAppend = typeof configuredAppend === 'string' && configuredAppend.trim() !== '';
  if (!hasAppend) {
    add('style-guide', false, 'chưa có platform_hints.zalo.append — chạy lại install:hermes để ghi hướng dẫn mặc định');
  } else {
    const canonical = existsSync(styleGuidePath(root)) ? readFileSync(styleGuidePath(root), 'utf8').trim() : null;
    const isDefault = canonical !== null && configuredAppend.trim() === canonical;
    add('style-guide', true, isDefault
      ? 'đã ghi hướng dẫn trình bày mặc định'
      : 'khách đang dùng bản hướng dẫn riêng — giữ nguyên');
  }
  const sidecarToken = readBridgeToken(join(root, '.env'));
  const hermesToken = config?.platforms?.zalo?.extra?.bridge_token;
  add('bridge-token', Boolean(sidecarToken && hermesToken && sidecarToken === String(hermesToken)));
  add('sidecar-server', existsSync(join(root, 'server.js')));
  if (!skipPython) {
    const python = pythonPath(layout.repoRoot);
    const probe = python ? commandProbe(python, ['-c', 'import websockets'], { encoding: 'utf8' }) : null;
    add('python-websockets', Boolean(python && probe?.status === 0));
    // Bộ giải mã JPEG XL chỉ là tuỳ chọn: thiếu thì bot vẫn chạy, chỉ báo với
    // người gửi là chưa đọc được ảnh dạng đó. Không đánh hỏng cả bản chẩn đoán.
    const jxl = python ? commandProbe(python, ['-c', 'import pillow_jxl'], { encoding: 'utf8' }) : null;
    add('python-pillow-jxl', true, jxl?.status === 0
      ? 'có — ảnh JPEG XL được chuyển sang JPG'
      : 'thiếu — ảnh chỉ có bản JPEG XL sẽ báo lỗi; cài bằng: uv pip install --python <venv Hermes> pillow-jxl-plugin');
    // Thư viện dựng tệp cho zalo_make_file cũng là tuỳ chọn: thiếu thì chỉ công cụ đó báo lỗi.
    const docs = python ? commandProbe(python, ['-c', 'import docx, pptx, openpyxl, fpdf'], { encoding: 'utf8' }) : null;
    add('python-document-libs', true, docs?.status === 0
      ? 'có — bot tạo được tệp Word/PowerPoint/Excel/PDF'
      : 'thiếu — bot chưa tạo được tệp; cài bằng: uv pip install --python <venv Hermes> python-docx python-pptx openpyxl fpdf2');
  }
  return { ok: checks.every((check) => check.ok), checks };
}

export async function installHermes({
  sidecarRoot,
  hermesHome,
  skipPython = false,
  commandProbe = spawnSync,
} = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Cần Node.js 22 trở lên');
  const root = resolve(sidecarRoot);
  const layout = resolveHermesLayout({ hermesHome });
  const token = ensureSidecarEnv(root, layout.home);
  mkdirSync(join(root, 'data'), { recursive: true });

  const platformDestination = join(layout.repoRoot, 'plugins', 'platforms', 'zalo');
  const toolsDestination = join(layout.repoRoot, 'plugins', 'zalo_tools');
  atomicReplaceDirectory(join(root, 'hermes-plugin', 'zalo'), platformDestination);
  atomicReplaceDirectory(join(root, 'hermes-plugin', 'zalo_tools'), toolsDestination);
  const manifestPath = join(platformDestination, 'plugin.yaml');
  writeFileSync(manifestPath, renderPlatformManifest(readFileSync(manifestPath, 'utf8'), root), 'utf8');

  const styleGuide = readStyleGuide(root);
  const currentConfig = existsSync(layout.configPath) ? readFileSync(layout.configPath, 'utf8') : '';
  const nextConfig = mergeHermesConfig(currentConfig, { bridgeToken: token, styleGuide });
  if (nextConfig !== currentConfig) {
    // Giữ bản cũ cạnh bản mới: config.yaml là của khách, lỡ trình cài ghi sai
    // thì vẫn còn đường khôi phục.
    if (currentConfig) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
      writeFileSync(`${layout.configPath}.bak-${stamp}`, currentConfig, 'utf8');
    }
    atomicWriteText(layout.configPath, nextConfig);
  }
  ensureWebsockets(layout.repoRoot, layout.home, { skipPython });
  ensureJxlDecoder(layout.repoRoot, layout.home, { skipPython });
  const diagnosis = doctorHermes({
    sidecarRoot: root,
    hermesHome: layout.home,
    skipPython,
    commandProbe,
  });
  if (!diagnosis.ok) throw new Error(`Cài đặt chưa hoàn chỉnh: ${JSON.stringify(diagnosis.checks)}`);
  return diagnosis;
}

export function uninstallHermes({ hermesHome } = {}) {
  const layout = resolveHermesLayout({ hermesHome });
  const pluginRoot = join(layout.repoRoot, 'plugins');
  const targets = [join(pluginRoot, 'platforms', 'zalo'), join(pluginRoot, 'zalo_tools')];
  for (const target of targets) {
    if (!within(pluginRoot, target)) throw new Error(`Đích gỡ cài đặt không an toàn: ${target}`);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  return { ok: true, removed: targets };
}
