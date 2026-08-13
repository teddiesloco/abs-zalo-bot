const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3871;
const DEFAULT_ACCOUNT = "default";
const DEFAULT_LOCAL_PORT = 13871;

function port(value, name, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function text(value, fallback = "") {
  const result = String(value ?? fallback).trim();
  return result || fallback;
}

function shellArg(value) {
  const raw = text(value);
  if (!raw || /[\r\n]/.test(raw)) throw new Error("SSH value cannot be empty or multiline");
  if (/^[A-Za-z0-9._:@%+-]+$/.test(raw)) return raw;
  return `'${raw.replaceAll("'", "'\\''")}'`;
}

function baseUrl(value, fallback) {
  const raw = text(value, fallback).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("dashboard URL must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("dashboard URL must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function buildSshTunnelCommand({
  localPort = DEFAULT_LOCAL_PORT,
  remotePort = DEFAULT_PORT,
  sshUser,
  sshHost,
} = {}) {
  const local = port(localPort, "localPort", DEFAULT_LOCAL_PORT);
  const remote = port(remotePort, "remotePort", DEFAULT_PORT);
  const user = shellArg(sshUser || "user");
  const host = shellArg(sshHost || "your-vps-host");
  return `ssh -N -L ${local}:127.0.0.1:${remote} ${user}@${host}`;
}

export function buildOnboardingInfo({
  host = DEFAULT_HOST,
  port: dashboardPort = DEFAULT_PORT,
  accountId = DEFAULT_ACCOUNT,
  localPort = DEFAULT_LOCAL_PORT,
  sshUser = "user",
  sshHost = "your-vps-host",
  publicUrl = "",
} = {}) {
  const bindHost = text(host, DEFAULT_HOST);
  const remotePort = port(dashboardPort, "port", DEFAULT_PORT);
  const account = encodeURIComponent(text(accountId, DEFAULT_ACCOUNT));
  const localHost = bindHost === "0.0.0.0" || bindHost === "::" ? DEFAULT_HOST : bindHost;
  const dashboardUrl = `http://${localHost}:${remotePort}`;
  const connectUrl = `${dashboardUrl}/connect`;
  const tunnelCommand = buildSshTunnelCommand({
    localPort,
    remotePort,
    sshUser,
    sshHost,
  });
  const publicBase = publicUrl ? baseUrl(publicUrl, dashboardUrl) : "";

  return {
    dashboard_url: dashboardUrl,
    connect_url: connectUrl,
    qr_api_url: `${dashboardUrl}/api/accounts/${account}/qr`,
    qr_location: "browser",
    note: "Open the connect URL in a browser. The QR is never printed in logs or sent to chat.",
    vps: {
      browser_url: `http://127.0.0.1:${localPort}/connect`,
      ssh_tunnel_command: tunnelCommand,
      ...(publicBase ? { public_url: `${publicBase}/connect` } : {}),
    },
  };
}

export function onboardingFromEnv(env = process.env) {
  return buildOnboardingInfo({
    host: env.HOST || env.DASHBOARD_BIND || DEFAULT_HOST,
    port: env.PORT || env.DASHBOARD_PORT || DEFAULT_PORT,
    accountId: env.DEFAULT_ACCOUNT_ID || DEFAULT_ACCOUNT,
    localPort: env.QR_LOCAL_PORT || DEFAULT_LOCAL_PORT,
    sshUser: env.DASHBOARD_SSH_USER || env.SSH_USER || "user",
    sshHost: env.DASHBOARD_SSH_HOST || env.SSH_HOST || "your-vps-host",
    publicUrl: env.DASHBOARD_PUBLIC_URL || "",
  });
}

export { DEFAULT_LOCAL_PORT };
