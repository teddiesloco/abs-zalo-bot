import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildOnboardingInfo, buildSshTunnelCommand } from "../src/onboarding.js";

const root = process.cwd();

test("local onboarding points the user to the browser QR page", () => {
  const info = buildOnboardingInfo({ host: "127.0.0.1", port: 3871 });

  assert.equal(info.dashboard_url, "http://127.0.0.1:3871");
  assert.equal(info.connect_url, "http://127.0.0.1:3871/connect");
  assert.equal(info.qr_api_url, "http://127.0.0.1:3871/api/accounts/default/qr");
  assert.equal(info.qr_location, "browser");
});

test("VPS onboarding gives a safe SSH tunnel and local browser URL", () => {
  const info = buildOnboardingInfo({
    host: "127.0.0.1",
    port: 3871,
    accountId: "default",
    localPort: 13871,
    sshUser: "deploy",
    sshHost: "vps.example.test",
  });

  assert.equal(info.connect_url, "http://127.0.0.1:3871/connect");
  assert.equal(info.vps.browser_url, "http://127.0.0.1:13871/connect");
  assert.equal(
    info.vps.ssh_tunnel_command,
    "ssh -N -L 13871:127.0.0.1:3871 deploy@vps.example.test",
  );
  assert.equal(buildSshTunnelCommand({ localPort: 13871, remotePort: 3871, sshUser: "deploy", sshHost: "vps.example.test" }), info.vps.ssh_tunnel_command);
});

test("public connect page explains where the QR is shown", () => {
  const html = fs.readFileSync(path.join(root, "public", "connect.html"), "utf8");
  assert.match(html, /Kết nối Zalo bằng QR/);
  assert.match(html, /Tạo mã QR/);
  assert.match(html, /Quét mã này bằng ứng dụng Zalo/);
  assert.match(html, /x-bridge-token/);
  assert.match(html, /Không gửi QR vào chat hoặc log/);
});
