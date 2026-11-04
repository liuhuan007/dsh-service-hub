// 添加条目的 id 派生：客户端不带 id 也应能添加，且重复添加不产生重复条目
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'console', 'server.mjs');
const PORT = 47800 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'lc-items-'));
let child;

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

function raw(method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = request({
      host: '127.0.0.1', port: PORT, method, path: p,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': payload.length }
        : {},
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitFor(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

before(async () => {
  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, LC_PORT: String(PORT), LC_DATA_DIR: path.join(tmp, 'data'), LC_LOG_DIR: path.join(tmp, 'logs') },
    stdio: 'ignore',
  });
  await waitFor(`${BASE}/healthz`);
});

after(() => {
  try { child.kill(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});

test('未提供 id 时服务端自动派生', async () => {
  const res = await raw('POST', '/api/items', { name: 'Discovered Redis', exe: 'redis-server', args: ['--port', '6379'] });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.ok(body.item && body.item.id, '应返回派生出的 id');
  assert.match(body.item.id, SAFE_ID);
});

test('纯中文名称也能得到合法 id', async () => {
  const res = await raw('POST', '/api/items', { name: '发现的服务', exe: 'cmd.exe' });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.match(body.item.id, SAFE_ID);
});

test('同名重复添加复用同一个 id，不产生重复条目', async () => {
  const first = JSON.parse((await raw('POST', '/api/items', { name: 'Discovered Redis', exe: 'redis-server' })).text);
  const second = JSON.parse((await raw('POST', '/api/items', { name: 'Discovered Redis', exe: 'redis-server' })).text);
  assert.equal(first.item.id, second.item.id);
  const state = await (await fetch(`${BASE}/api/state`)).json();
  const same = state.items.filter((i) => i.name === 'Discovered Redis');
  assert.equal(same.length, 1, '同名条目只应存在一个');
});

test('显式 id 保持原样', async () => {
  const res = await raw('POST', '/api/items', { id: 'explicit-id-1', name: 'Explicit', exe: 'cmd.exe' });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).item.id, 'explicit-id-1');
});