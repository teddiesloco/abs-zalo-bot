import test from 'node:test';
import assert from 'node:assert/strict';

import { createOaAutoReplyWorker } from '../src/oa_auto_reply.js';

const registry = {
  version: 1,
  bots: [{
    bot_id: 'phuquy-local', tenant_id: 'phuquy_local', name: 'Phú Quý Local',
    adapter: 'zalo_oa', enabled: true,
    credential: { app_id_env: 'APP', app_secret_env: 'SECRET', refresh_token_env: 'REFRESH' },
    policy: { mode: 'inbound_auto_reply', max_messages_per_hour: 2 },
  }],
};

function event(id = 'evt-1') {
  return { event_id: id, bot_id: 'phuquy-local', sender_id: 'guest-1', text: 'Đi Phú Quý 2 ngày thế nào?' };
}

test('replies only to a verified customer event and sends the public-chat answer back to that sender', async () => {
  const calls = [];
  const worker = createOaAutoReplyWorker({
    registry,
    adapters: new Map([['phuquy-local', { sendText: async (value) => { calls.push(value); return { ok: true }; } }]]),
    publicBridgeToken: 'bridge-secret',
    fetchImpl: async (_url, init) => ({ ok: true, json: async () => { calls.push(JSON.parse(init.body)); return { answer: 'Dạ, em gợi ý lịch 2 ngày 1 đêm nha.' }; } }),
  });

  assert.deepEqual(await worker.handle(event()), { ok: true, delivered: true, delivery: { ok: true } });
  assert.deepEqual(calls, [
    { message: 'Đi Phú Quý 2 ngày thế nào?', channel: 'zalo-oa' },
    { recipient_id: 'guest-1', text: 'Dạ, em gợi ý lịch 2 ngày 1 đêm nha.', correlation_id: 'evt-1' },
  ]);
});

test('does not reply twice to a duplicate provider event', async () => {
  let sent = 0;
  const worker = createOaAutoReplyWorker({
    registry,
    adapters: new Map([['phuquy-local', { sendText: async () => { sent += 1; return { ok: true }; } }]]),
    publicBridgeToken: 'bridge-secret',
    fetchImpl: async () => ({ ok: true, json: async () => ({ answer: 'Dạ, em đây.' }) }),
  });
  await worker.handle(event('same'));
  assert.deepEqual(await worker.handle(event('same')), { ok: true, skipped: 'duplicate_event' });
  assert.equal(sent, 1);
});

test('fails closed when user-initiated auto-reply mode or bridge authentication is absent', async () => {
  const draftOnly = structuredClone(registry);
  draftOnly.bots[0].policy.mode = 'draft_first';
  const worker = createOaAutoReplyWorker({ registry: draftOnly, publicBridgeToken: '' });
  assert.deepEqual(await worker.handle(event()), { ok: true, skipped: 'inbound_auto_reply_disabled' });
});
