// 控制台安全回归测试：验证 C1（跨源拒绝）与 C2（路径穿越/非法 id）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'console', 'server.mjs');
const PORT = 47100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'lc-security-'));
let child;

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${url}`);
}

/** 用 node:http 发送原始请求：fetch 会丢弃 sec-fetch-* 等禁止头，模拟不真实 */
function raw(method, p, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = request({
      host: '127.0.0.1',
      port: PORT,
      method,
      path: p,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      LC_PORT: String(PORT),
      LC_DATA_DIR: path.join(tmp, 'data'),
      LC_LOG_DIR: path.join(tmp, 'logs'),
    },
    stdio: 'ignore',
  });
  await waitFor(`${BASE}/healthz`);
});

after(() => {
  try { child.kill(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});

test('healthz 暴露守护进程身份且不带 CORS 头', async () => {
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-lc-daemon'), '缺少 X-LC-Daemon 头');
  assert.equal(res.headers.get('access-control-allow-origin'), null, '不应返回 CORS 通配');
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('跨站脚本请求被拒绝（Origin + Sec-Fetch-Site）', async () => {
  const res = await raw('POST', '/api/items', {
    origin: 'https://evil.example',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  }, { id: 'evil', exe: 'cmd.exe' });
  assert.equal(res.status, 403);
});

test('跨站脚本请求被拒绝（Sec-Fetch-Site）', async () => {
  const res = await raw('GET', '/api/state', { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' });
  assert.equal(res.status, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined, '不应返回 CORS 通配');
});

test('iframe / 顶层导航仍可放行', async () => {
  const res = await raw('GET', '/', { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-site' });
  assert.equal(res.status, 200);
});

test('非法 id 被拒绝（路径穿越防护）', async () => {
  const res = await raw('POST', '/api/items', {}, { id: '..\\..\\evil', exe: 'cmd.exe' });
  assert.equal(res.status, 400);
  const res2 = await raw('POST', '/api/items', {}, { id: '../etc/passwd', exe: 'cmd.exe' });
  assert.equal(res2.status, 400);
  const res3 = await raw('POST', '/api/items', {}, { id: 'a'.repeat(80), exe: 'cmd.exe' });
  assert.equal(res3.status, 400);
});

test('穿越日志路径不会读到文件', async () => {
  const res = await fetch(`${BASE}/api/items/..%5c..%5csecret/logs`);
  assert.equal(res.status, 404);
});

test('本机合法请求可用', async () => {
  const res = await raw('POST', '/api/items', {}, { id: 'demo-safe', name: 'demo', exe: 'cmd.exe', args: ['/c', 'echo hi'] });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).item.id, 'demo-safe');
});