// local-console - 本地工具/服务统一控制台 (daemon)
// 无第三方依赖，纯 Node 标准库。Node >= 18。
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.LC_DATA_DIR || path.join(ROOT, 'data');
const LOG_DIR = process.env.LC_LOG_DIR || path.join(ROOT, 'logs');
const PUBLIC_DIR = path.join(ROOT, 'public');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');
const RUNTIME_PATH = path.join(DATA_DIR, 'runtime.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const HOST = '127.0.0.1';
const PORT = Number(process.env.LC_PORT || 3999);
const VERSION = '0.1.0';
const STARTED_AT = new Date().toISOString();
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

for (const d of [DATA_DIR, LOG_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- 注册表 ----------
function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return { version: 1, items: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    if (!Array.isArray(raw.items)) raw.items = [];
    // 磁盘上的条目也必须归一化：手写/脚本写入的条目可能缺 args/env 等字段
    raw.items = raw.items
      .map((it) => { try { return normalizeItem(it); } catch (e) { return null; } })
      .filter(Boolean);
    return raw;
  } catch (e) {
    try { fs.copyFileSync(REGISTRY_PATH, REGISTRY_PATH + '.bad-' + Date.now()); } catch {}
    return { version: 1, items: [] };
  }
}
let registry = loadRegistry();
try { saveRegistry(); } catch (e) {}   // 归一化后立刻落盘，修正缺字段的旧条目

function saveRegistry() {
  const tmp = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
  fs.renameSync(tmp, REGISTRY_PATH);
}

function loadRuntime() {
  try { return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8')); } catch { return {}; }
}
function saveRuntime() {
  const out = {};
  for (const [id, st] of procs) {
    if (st.child && st.child.exitCode !== null) continue;
    if (st.failed) continue;
    const pid = st.adoptedPid || (st.child ? st.child.pid : null);
    if (pid) out[id] = { pid, url: st.url || null, port: st.port || null, startedAt: st.startedAt };
  }
  try { fs.writeFileSync(RUNTIME_PATH, JSON.stringify(out, null, 2), 'utf8'); } catch {}
}

// ---------- 运行历史（一次性脚本） ----------
let history = loadHistory();
// 裁掉已删除条目残留的历史，避免无限累积
(function pruneHistory() {
  const alive = new Set(registry.items.map((i) => i.id));
  let changed = false;
  for (const id of Object.keys(history)) { if (!alive.has(id)) { delete history[id]; changed = true; } }
  if (changed) saveHistory();
})();
function loadHistory() {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
function saveHistory() {
  const tmp = HISTORY_PATH + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(history, null, 2), 'utf8'); fs.renameSync(tmp, HISTORY_PATH); } catch {}
}
function recordRun(id, run) {
  if (!history[id]) history[id] = [];
  history[id].unshift(run);
  history[id] = history[id].slice(0, 30);
  saveHistory();
}
function logPathFor(item) {
  if (item.kind !== 'script') return path.join(LOG_DIR, item.id + '.log');
  const runs = history[item.id] || [];
  return runs.length && runs[0].logPath ? runs[0].logPath : path.join(LOG_DIR, item.id + '.log');
}

function normalizeItem(raw) {
  const it = {
    id: String(raw.id || '').trim(),
    name: String(raw.name || raw.id || '未命名').trim(),
    kind: ['app','script','terminal'].indexOf(raw.kind) >= 0 ? raw.kind : 'service',
    group: raw.group ? String(raw.group) : '',
    exe: String(raw.exe || '').trim(),
    args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    cwd: raw.cwd ? String(raw.cwd) : null,
    env: raw.env && typeof raw.env === 'object' ? raw.env : {},
    url: raw.url ? String(raw.url) : null,
    port: raw.port != null && raw.port !== '' ? Number(raw.port) : null,
    note: raw.note ? String(raw.note) : null,
    shell: raw.shell ? String(raw.shell) : '',
    versionCmd: Array.isArray(raw.versionCmd) ? raw.versionCmd.map(String) : null,
    upgradeExe: raw.upgradeExe ? String(raw.upgradeExe) : null,
    upgradeArgs: Array.isArray(raw.upgradeArgs) ? raw.upgradeArgs.map(String) : null,
    detached: raw.detached === true,
    healthExpect: raw.healthExpect ? String(raw.healthExpect) : null,
    healthUrl: raw.healthUrl ? String(raw.healthUrl) : null,
    healthPort: raw.healthPort != null && raw.healthPort !== '' ? Number(raw.healthPort) : null,
    healthProc: raw.healthProc ? String(raw.healthProc) : null,
    healthCmd: Array.isArray(raw.healthCmd) ? raw.healthCmd.map(String) : null,
    stopArgs: Array.isArray(raw.stopArgs) ? raw.stopArgs.map(String) : null,
  };
  if (!it.id) throw new Error('id 不能为空');
  if (!it.exe) throw new Error('exe 不能为空');
  return it;
}

// ---------- 进程状态 ----------
const procs = new Map(); // id -> { child, adoptedPid, logPath, url, port, startedAt, health, healthAt, failed }

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function statusOf(item) {
  const st = procs.get(item.id);
  if (item.detached) {
    if (st && st.detachedRunning) return 'running';
    if (st && st.detachedFailed) return 'error';
    return 'stopped';
  }
  if (!st) return 'stopped';
  if (st.failed) return 'error';
  // 刚点过启动、还没被探活确认的 10 秒内，显示「启动中」而不是「已停止」
  if (st.launchAt && Date.now() - st.launchAt < 10000) {
    const nowRunning = (st.child && st.child.exitCode === null) || st.externalOk || st.detachedRunning || (st.adoptedPid && pidAlive(st.adoptedPid));
    if (!nowRunning) return 'starting';
  }
  if (st.child) {
    if (st.child.exitCode === null && !st.child.killed) return 'running';
    if (st.stopping) return 'stopped';
    return st.child.exitCode === 0 ? 'stopped' : 'error';
  }
  if (st.adoptedPid) return pidAlive(st.adoptedPid) ? 'running' : 'stopped';
  if (st.externalOk) return 'running';
  return 'stopped';
}

function currentPid(item) {
  const st = procs.get(item.id);
  if (!st) return null;
  if (st.adoptedPid) return pidAlive(st.adoptedPid) ? st.adoptedPid : null;
  return st.child && st.child.exitCode === null ? st.child.pid : null;
}

// ---------- 控制台日志（启动/未捕获错误都落盘） ----------
const CONSOLE_LOG = path.join(LOG_DIR, 'console.log');
function consoleLog(line) {
  try {
    const size = fs.existsSync(CONSOLE_LOG) ? fs.statSync(CONSOLE_LOG).size : 0;
    if (size > 2 * 1024 * 1024) fs.writeFileSync(CONSOLE_LOG, '', 'utf8'); // 超过 2MB 清空
    fs.appendFileSync(CONSOLE_LOG, new Date().toISOString() + '  ' + line + '\n', 'utf8');
  } catch {}
}
consoleLog('==== 控制台启动 pid=' + process.pid + ' port=' + PORT + ' ====');
process.on('uncaughtException', (e) => { consoleLog('[uncaughtException] ' + ((e && e.stack) || e)); });
process.on('unhandledRejection', (e) => { consoleLog('[unhandledRejection] ' + ((e && e.stack) || e)); });
process.on('exit', (code) => { consoleLog('==== 控制台退出 code=' + code + ' ===='); });
// ---------- 访问地址自动探测（进程树 -> netstat） ----------
let portScanBusy = false;
function detectPorts() {
  if (portScanBusy) return;
  const roots = [];
  for (const it of registry.items) {
    const s = procs.get(it.id);
    if (!s || (s.url && s.port)) continue;
    const rp = s.adoptedPid || (s.child && s.child.exitCode === null ? s.child.pid : null);
    if (!rp) continue;
    if (s.portAt && Date.now() - s.portAt < 15000) continue;
    s.portAt = Date.now();
    roots.push({ item: it, st: s, rootPid: rp });
  }
  if (!roots.length) return;
  portScanBusy = true;
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress';
  execFile(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 25000, windowsHide: true, maxBuffer: 16e6 }, (err, out) => {
    if (err) { portScanBusy = false; return; }
    let list = [];
    try { const j = JSON.parse(String(out || '[]')); list = Array.isArray(j) ? j : [j]; } catch { portScanBusy = false; return; }
    const children = new Map();
    for (const e of list) { if (!children.has(e.ParentProcessId)) children.set(e.ParentProcessId, []); children.get(e.ParentProcessId).push(e.ProcessId); }
    const owner = new Map();
    for (const r of roots) {
      const stack = [r.rootPid], seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        owner.set(cur, r);
        for (const c of (children.get(cur) || [])) stack.push(c);
      }
    }
    execFile('netstat', ['-ano', '-p', 'tcp'], { timeout: 25000, windowsHide: true, maxBuffer: 16e6 }, (e2, ns) => {
      portScanBusy = false;
      if (e2) return;
      for (const line of String(ns || '').split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (!m) continue;
        const hit = owner.get(Number(m[3]));
        if (!hit || hit.st.url) continue;
        const port = Number(m[2]);
        if (port > 60000) continue;
        hit.st.port = port;
        hit.st.url = 'http://127.0.0.1:' + port;
        hit.st.probedUrl = true;
      }
    });
  });
}

// ---------- 本机地址 / 端口探活 ----------
function lanIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // 排序：真实局域网段优先；Tailscale(100.64/10)、Hyper-V/Docker(172.16-31)、链路本地 靠后
  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip)) return 9; // CGNAT / Tailscale
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 8;                // Hyper-V / Docker
    if (/^169\.254\./.test(ip)) return 10;
    return 5;
  };
  return out.sort((a, b) => score(a) - score(b));
}
function tcpProbe(port, cb) {
  const sock = new net.Socket();
  let done = false;
  const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch {} cb(ok); };
  sock.setTimeout(2500);
  sock.once('connect', () => finish(true));
  sock.once('timeout', () => finish(false));
  sock.once('error', () => finish(false));
  try { sock.connect(Number(port), '127.0.0.1'); } catch { finish(false); }
}
function lanUrlOf(item, st) {
  const raw = (st && st.url) || item.url || null;
  if (!raw) return null;
  const ips = lanIps();
  if (!ips.length) return null;
  return raw.replace(/127\.0\.0\.1|localhost|\[::1\]/i, ips[0]);
}

// ---------- 版本探测 ----------
const versionCache = new Map(); // id -> { version, at }
function probeVersion(item, force) {
  if (!item.versionCmd || !item.versionCmd.length) return;
  const cached = versionCache.get(item.id);
  if (!force && cached && Date.now() - cached.at < 60000) return;
  versionCache.set(item.id, { version: cached ? cached.version : null, at: Date.now() });
  execFile(item.exe, item.versionCmd, { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
    if (err) { versionCache.set(item.id, { version: null, at: Date.now() }); return; }
    const text = (String(stdout || '') + '\n' + String(stderr || '')).trim();
    const m = text.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?)/);
    const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) || null;
    versionCache.set(item.id, { version: m ? m[1] : first, at: Date.now() });
  });
}

function itemView(item) {
  const st = procs.get(item.id);
  const status = statusOf(item);
  let health = 'down';
  if (status === 'running') {
    if (st && st.healthAt && st.health) health = st.health;
    else health = item.healthCmd ? 'unknown' : 'unknown';
    if (st && st.health === 'down') health = 'down';
  }
  return {
    id: item.id, name: item.name, kind: item.kind, group: item.group,
    status, health,
    pid: currentPid(item),
    url: (st && st.probedUrl && status !== 'running') ? null : ((st && st.url) || item.url || null),
    port: (st && st.probedUrl && status !== 'running') ? null : ((st && st.port) || item.port || null),
    startedAt: (st && st.startedAt) || null,
    exitCode: st && st.child ? st.child.exitCode : null,
    lastError: (st && st.failed) || null,
    note: item.note,
    shell: item.shell || '',
    urlLan: lanUrlOf(item, procs.get(item.id)),
    currentVersion: (versionCache.get(item.id) || {}).version || null,
    hasVersion: !!(item.versionCmd && item.versionCmd.length),
    canUpgrade: !!(item.upgradeExe || (item.upgradeArgs && item.upgradeArgs.length)),
    canStop: item.kind !== 'script' && item.kind !== 'terminal',
    lastRun: item.kind === 'script' ? ((history[item.id] || [])[0] || null) : null,
    command: [item.exe].concat(item.args || []).join(' '),
    exe: item.exe, args: item.args, cwd: item.cwd,
  };
}

function appendLog(file, text) {
  try { fs.appendFileSync(file, text, 'utf8'); } catch {}
}

function tail(file, lines) {
  if (!fs.existsSync(file)) return '';
  try {
    const size = fs.statSync(file).size;
    const cap = 512 * 1024;
    let buf;
    if (size <= cap) buf = fs.readFileSync(file);
    else {
      const fd = fs.openSync(file, 'r');
      buf = Buffer.alloc(cap);
      fs.readSync(fd, buf, 0, cap, size - cap);
      fs.closeSync(fd);
    }
    const arr = buf.toString('utf8').split(/\r?\n/);
    return arr.slice(Math.max(0, arr.length - lines)).join('\n');
  } catch { return ''; }
}

function detectUrl(text, st) {
  const m = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):(\d{2,5})/i);
  if (m) { st.port = Number(m[1]); st.url = 'http://127.0.0.1:' + m[1]; st.probedUrl = true; }
}

/** 按扩展名/显式 shell 选择解释器：.ps1 -> powershell -File；.cmd/.bat -> cmd /c。 */
function buildArgv(item) {
  const ext = path.extname(item.exe).toLowerCase();
  const shell = String(item.shell || '').toLowerCase();
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  if (shell === 'cmd' || ext === '.cmd' || ext === '.bat' || shell === 'pwsh' || shell === 'powershell' || ext === '.ps1') {
    // 统一用 PowerShell 当启动器：避开 cmd.exe 的引号转义坑，并预置 UTF-8 输出编码
    // （脚本文件本身要带 BOM，否则 5.1 读中文会乱码——这是 PowerShell 的行为，不是本工具的）
    const pre = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[System.Text.UTF8Encoding]::new($false);";
    const call = '& ' + q(item.exe) + item.args.map((a) => ' ' + q(a)).join('');
    return { exe: PS, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', pre + call] };
  }
  return { exe: item.exe, args: item.args };
}

/** 终端工具：在指定目录打开一个新控制台窗口运行命令 */
function startTerminal(item) {
  const q = (s) => (/\s/.test(String(s)) ? '"' + String(s) + '"' : String(s));
  const line = [item.exe].concat(item.args || []).map(q).join(' ');
  const cwd = item.cwd && fs.existsSync(item.cwd) ? item.cwd : (process.env.USERPROFILE || undefined);
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', 'cmd', '/k', line], {
    cwd,
    windowsHide: false,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return itemView(item);
}

async function startItem(item) {
  if (item.kind === 'terminal') return startTerminal(item);
  if (statusOf(item) === 'running') {
    if (item.detached) return itemView(item);
    throw new Error('已经在运行');
  }
  const isScript = item.kind === 'script';
  const runId = isScript ? new Date().toISOString().replace(/[:.]/g, '-') : null;
  let logPath = path.join(LOG_DIR, item.id + '.log');
  if (isScript) { logPath = path.join(LOG_DIR, item.id, runId + '.log'); fs.mkdirSync(path.dirname(logPath), { recursive: true }); }
  appendLog(logPath, '\n=== ' + new Date().toISOString() + ' 启动: ' + item.exe + ' ' + item.args.join(' ') + '\n');
  const st = {
    child: null, adoptedPid: null, logPath,
    url: item.url || null, port: item.port || null,
    startedAt: new Date().toISOString(), health: 'unknown', healthAt: 0, failed: null,
    isScript, runId,
    launchAt: Date.now(),
  };
  let child;
  try {
    const argv = buildArgv(item);
    const spawnOpts = {
      cwd: item.cwd && fs.existsSync(item.cwd) ? item.cwd : undefined,
      env: Object.assign({}, process.env, item.env || {}),
      windowsHide: true,
    };
    if (item.kind === 'script') {
      child = spawn(argv.exe, argv.args, Object.assign({}, spawnOpts, { detached: false, stdio: ['ignore', 'pipe', 'pipe'] }));
    } else if (item.kind === 'app' && (!argv.args || argv.args.length === 0)) {
      // GUI 程序必须经 explorer 转发：守护进程不在交互式桌面会话里，直接 spawn 窗口出不来
      child = spawn('explorer.exe', [argv.exe], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    } else {
      const fd = fs.openSync(logPath, 'a');
      try {
        child = spawn(argv.exe, argv.args, Object.assign({}, spawnOpts, { detached: true, stdio: ['ignore', fd, fd] }));
      } finally { fs.closeSync(fd); }
      child.unref();
    }
  } catch (e) {
    st.failed = e.message;
    procs.set(item.id, st);
    throw e;
  }
  st.child = (item.kind === 'app' && !((item.args || []).length)) ? null : child;
  if (item.detached) st.detachedFailed = false;
  procs.set(item.id, st);
  if (child.stdout) {
    const onData = (buf) => { const t = buf.toString('utf8'); appendLog(logPath, t); detectUrl(t, st); };
    child.stdout.on('data', onData);
    if (child.stderr) child.stderr.on('data', onData);
  }
  child.on('error', (e) => { st.failed = e.message; appendLog(logPath, '\n[启动失败] ' + e.message + '\n'); });
  if (item.healthCmd || item.healthUrl || item.healthPort || item.healthProc) {
    // 启动后主动多次复探：GUI/分离式服务需要一两秒才真正就绪，
    // 而 healthAt 有 15 秒节流，不主动触发就会一直显示旧状态
    for (const delay of [1200, 3000, 6000, 12000]) {
      setTimeout(() => {
        const s = procs.get(item.id);
        if (s) s.healthAt = 0;
        checkHealth(item);
        detectPorts();
      }, delay);
    }
  }
  for (const delay of [3000, 10000]) setTimeout(detectPorts, delay);
  child.on('exit', (code, sig) => {
    const endedAt = new Date().toISOString();
    appendLog(logPath, '\n=== 退出 code=' + code + ' signal=' + sig + '\n');
    if (item.detached && code !== 0) st.detachedFailed = true;
    if (isScript) recordRun(item.id, { kind: 'run', runId, startedAt: st.startedAt, endedAt, durationMs: Date.parse(endedAt) - Date.parse(st.startedAt), exitCode: code, signal: sig || null, ok: code === 0, logPath });
    saveRuntime();
  });
  saveRuntime();
  return itemView(item);
}

/** 外部启动的条目：按进程名或端口反查 pid，才能停得掉 */
function resolveExternalPid(item) {
  try {
    if (item.healthProc) {
      const out = execFileSync('tasklist', ['/fi', 'imagename eq ' + item.healthProc, '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      const m = String(out || '').match(/^"([^"]+)","(\d+)"/m);
      if (m) return Number(m[2]);
    }
  } catch {}
  try {
    if (item.healthPort) {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      for (const line of String(out || '').split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (m && Number(m[1]) === Number(item.healthPort)) return Number(m[2]);
      }
    }
  } catch {}
  return null;
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function stopItem(item) {
  const st = procs.get(item.id);
  if (!st) return itemView(item);
  if (item.stopArgs && item.stopArgs.length) {
    await new Promise((resolve) => {
      execFile(item.exe, item.stopArgs, { timeout: 15000, windowsHide: true }, () => resolve());
    });
    await new Promise((r) => setTimeout(r, 1500));
  }
  st.stopping = true;
  st.launchAt = 0;   // 停止后不再显示「启动中」
  if (item.detached) { st.detachedRunning = false; st.detachedFailed = false; st.health = 'down'; st.healthAt = 0; }
  let pid = currentPid(item);
  if (!pid && (item.healthProc || item.healthPort)) pid = resolveExternalPid(item);
  if (pid) await killTree(pid);
  if (st.child) { try { st.child.kill(); } catch {} }
  st.adoptedPid = null;
  if (st.probedUrl) { st.url = item.url || null; st.port = item.port || null; st.probedUrl = false; }
  st.externalOk = false;
  st.health = 'down';
  st.healthAt = 0;
  if (item.detached) { st.detachedRunning = false; st.detachedFailed = false; }
  // 延迟复探：进程刚被杀时端口可能还没释放
  setTimeout(() => { const s2 = procs.get(item.id); if (s2) s2.healthAt = 0; checkHealth(item); }, 2200);
  saveRuntime();
  await new Promise((r) => setTimeout(r, 300));
  return itemView(item);
}

/** 强制探活并等待结果（给"单条刷新"用，绕过 15 秒节流） */
function probeNow(item) {
  return new Promise((resolve) => {
    if (!item.healthCmd && !item.healthUrl && !item.healthPort && !item.healthProc) {
      // 没有任何探活配置：只能按本地进程判断
      resolve(statusOf(item));
      return;
    }
    let st = procs.get(item.id);
    if (!st) {
      st = { child: null, adoptedPid: null, logPath: path.join(LOG_DIR, item.id + ".log"), url: item.url || null, port: item.port || null, startedAt: null, health: "unknown", healthAt: 0, failed: null };
      procs.set(item.id, st);
    }
    st.healthAt = 0;
    const localRunning = st.child ? st.child.exitCode === null : (st.adoptedPid ? pidAlive(st.adoptedPid) : false);
    const done = () => resolve(statusOf(item));
    const settle = (ok) => {
      st.health = ok ? "ok" : "down";
      st.healthAt = Date.now();
      if (item.detached) st.detachedRunning = ok;
      else st.externalOk = ok && !localRunning;
      done();
    };
    setTimeout(() => done(), 6000); // 兜底，避免挂死请求
    if (item.healthProc) {
      execFile("tasklist", ["/fi", "imagename eq " + item.healthProc, "/nh"], { timeout: 8000, windowsHide: true }, (err, out) => {
        const needle = String(item.healthProc).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        settle(!err && new RegExp(needle, "i").test(String(out || "")));
      });
      return;
    }
    if (item.healthPort) { tcpProbe(item.healthPort, settle); return; }
    if (item.healthUrl) {
      fetch(item.healthUrl).then((r) => settle(r.status < 500)).catch(() => settle(false));
      return;
    }
    execFile(item.exe, item.healthCmd, { timeout: 12000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout || "") + "\n" + String(stderr || "");
      let ok = !err;
      if (ok && item.healthExpect) ok = text.toLowerCase().indexOf(String(item.healthExpect).toLowerCase()) >= 0;
      settle(ok);
    });
  });
}

function checkHealth(item) {
  if (!item.healthCmd && !item.healthUrl && !item.healthPort && !item.healthProc) return;
  let st = procs.get(item.id);
  if (!st) {
    st = { child: null, adoptedPid: null, logPath: path.join(LOG_DIR, item.id + ".log"), url: item.url || null, port: item.port || null, startedAt: null, health: "unknown", healthAt: 0, failed: null };
    procs.set(item.id, st);
  }
  if (st.healthAt && Date.now() - st.healthAt < 15000) return;
  st.healthAt = Date.now();
  const localRunning = st.child ? st.child.exitCode === null : (st.adoptedPid ? pidAlive(st.adoptedPid) : false);
  const settle = (ok) => {
    st.health = ok ? "ok" : "down";
    st.healthAt = Date.now();
    if (item.detached) st.detachedRunning = ok;
    else st.externalOk = ok && !localRunning;
  };
  if (item.healthProc) {
    execFile('tasklist', ['/fi', 'imagename eq ' + item.healthProc, '/nh'], { timeout: 8000, windowsHide: true }, (err, out) => {
      const needle = String(item.healthProc).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      settle(!err && new RegExp(needle, 'i').test(String(out || '')));
    });
    return;
  }
  if (item.healthPort) { tcpProbe(item.healthPort, (ok) => settle(ok)); return; }
  if (item.healthUrl) {
    // HTTP 探活：任何 <500 的响应都算活着（例如需要鉴权的 401 也算在跑）
    fetch(item.healthUrl, { method: "GET" }).then((r) => settle(r.status < 500)).catch(() => settle(false));
    return;
  }
  execFile(item.exe, item.healthCmd, { timeout: 12000, windowsHide: true }, (err, stdout, stderr) => {
    const text = String(stdout || "") + "\n" + String(stderr || "");
    let ok = !err;
    if (ok && item.healthExpect) ok = text.toLowerCase().indexOf(String(item.healthExpect).toLowerCase()) >= 0;
    settle(ok);
  });
}

// ---------- 启动时接管上次留下的进程 ----------
(function adopt() {
  const rt = loadRuntime();
  for (const [id, info] of Object.entries(rt)) {
    if (info && info.pid && pidAlive(info.pid)) {
      procs.set(id, {
        child: null, adoptedPid: info.pid, logPath: path.join(LOG_DIR, id + '.log'),
        url: info.url || null, port: info.port || null,
        startedAt: info.startedAt || null, health: 'unknown', healthAt: 0, failed: null,
      });
    }
  }
})();

// ---------- 自动发现 ----------
function scanDirs() {
  const out = new Set();
  const home = process.env.USERPROFILE || '';
  const appdata = process.env.APPDATA || '';
  const add = (p) => { try { if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) out.add(p); } catch {} };
  add(path.join(appdata, 'npm'));
  add(path.join(home, '.local', 'bin'));
  add(path.join(home, '.agentsview', 'bin'));
  add('C:\\Users\\Administrator\\AppData\\Local\\Programs');
  const wb = path.join(home, '.workbuddy', 'binaries');
  try { for (const d of fs.readdirSync(wb, { withFileTypes: true })) if (d.isDirectory()) add(path.join(wb, d.name)); } catch {}
  for (const p of (process.env.PATH || '').split(';')) {
    const t = p.trim().replace(/^"|"$/g, '');
    if (!t) continue;
    if (/\\Windows(\\|$)/i.test(t)) continue;
    if (/Microsoft\\WindowsApps/i.test(t)) continue;
    if (/node_modules[\\/]\.bin$/i.test(t)) continue;
    add(t);
  }
  return [...out];
}

const SKIP_NAME = /(uninstall|unins\d*|crashpad|crashreporter|updater|update|setup|installer|elevate|helper|\.old$)/i;

function scanExeCandidates() {
  const registered = new Set(registry.items.map((i) => (i.exe || '').toLowerCase()));
  const found = [];
  const seen = new Set();
  for (const dir of scanDirs()) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    let n = 0;
    for (const e of entries) {
      if (n >= 60) break;
      if (!e.isFile()) continue;
      if (!/\.(exe|cmd|bat)$/i.test(e.name)) continue;
      if (SKIP_NAME.test(e.name)) continue;
      const full = path.join(dir, e.name);
      const key = full.toLowerCase();
      if (seen.has(key) || registered.has(key)) continue;
      seen.add(key);
      found.push({
        name: e.name.replace(/\.(exe|cmd|bat)$/i, ''),
        exe: full, args: [], cwd: dir, port: null, source: '目录: ' + dir,
      });
      n++;
    }
  }
  return found;
}

function portCandidates() {
  let text = '';
  try { text = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }); } catch { return []; }
  const ports = [];
  const seenPort = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!m) continue;
    const addr = m[1], port = Number(m[2]), pid = Number(m[3]);
    if (!pid || pid === process.pid) continue;
    if (port > 45000 || seenPort.has(port)) continue;
    if (!/^(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\])$/.test(addr)) continue;
    seenPort.add(port);
    ports.push({ port, pid });
  }
  if (!ports.length) return [];
  const ids = [...new Set(ports.map((p) => p.pid))].slice(0, 40);
  const ps = '$ids=@(' + ids.join(',') + '); Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress';
  let raw = '';
  try { raw = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20000 }); } catch { return []; }
  let list = [];
  try { const j = JSON.parse(raw.trim() || '[]'); list = Array.isArray(j) ? j : [j]; } catch { return []; }
  const byPid = new Map(list.map((x) => [x.Id, x]));
  const SKIP = /(system|svchost|lsass|services|wininit|smss|csrss|explorer|node|conhost|python|java|wpscloudsvr|trustservice|weixin|idea64|cef_server)/i;
  const out = [];
  const registered = new Set(registry.items.map((i) => (i.exe || '').toLowerCase()));
  for (const { port, pid } of ports) {
    const p = byPid.get(pid);
    if (!p || !p.Path || !p.ProcessName) continue;
    if (SKIP.test(p.ProcessName)) continue;
    if (registered.has(String(p.Path).toLowerCase())) continue;
    out.push({ name: p.ProcessName, exe: p.Path, args: [], cwd: path.dirname(p.Path), port, source: '监听端口 ' + port });
    if (out.length >= 15) break;
  }
  return out;
}

function discover() {
  const a = scanExeCandidates();
  const b = portCandidates();
  const seenExe = new Set();
  const merged = [];
  for (const c of b.concat(a)) {
    const k = c.exe.toLowerCase();
    if (seenExe.has(k)) continue;
    seenExe.add(k);
    merged.push(c);
    if (merged.length >= 60) break;
  }
  return merged;
}

// ---------- HTTP ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('JSON 解析失败')); } });
    req.on('error', reject);
  });
}
function findItem(id) { return registry.items.find((i) => i.id === id) || null; }

async function handler(req, res) {
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  const p = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const file = path.join(PUBLIC_DIR, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('public/index.html 不存在'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    if (req.method === 'GET' && p === '/api/state') {
      for (const it of registry.items) { checkHealth(it); probeVersion(it, false); }
      detectPorts();
      return json(res, 200, {
        daemon: { pid: process.pid, version: VERSION, startedAt: STARTED_AT, registryPath: REGISTRY_PATH, lanIps: lanIps() },
        items: registry.items.map(itemView),
      });
    }

    let m = p.match(/^\/api\/items\/([^/]+)\/(start|stop|restart|check|logs|upgrade)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const action = m[2];
      const item = findItem(id);
      if (!item) return json(res, 404, { ok: false, error: '没有这个条目: ' + id });
      if (action === 'logs' && req.method === 'GET') {
        const n = Math.min(2000, Math.max(20, Number(url.searchParams.get('lines') || 300)));
        return json(res, 200, { ok: true, text: tail(logPathFor(item), n) });
      }
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: '需要 POST' });
      try {
        if (action === 'start') return json(res, 200, { ok: true, item: await startItem(item) });
        if (action === 'stop') return json(res, 200, { ok: true, item: await stopItem(item) });
        if (action === 'restart') { await stopItem(item); await new Promise((r) => setTimeout(r, 500)); return json(res, 200, { ok: true, item: await startItem(item) }); }
      } catch (e) {
        return json(res, 200, { ok: false, error: (e && e.message) || String(e), item: itemView(item) });
      }
      if (action === 'upgrade') {
        if (statusOf(item) === 'running') { try { await stopItem(item); } catch (e) {} }
        const upRunId = new Date().toISOString().replace(/[:.]/g, '-');
        const upExe = item.upgradeExe || item.exe;
        const upArgs = item.upgradeArgs || [];
        const upLog = path.join(LOG_DIR, item.id, upRunId + '.log');
        fs.mkdirSync(path.dirname(upLog), { recursive: true });
        const upStarted = new Date().toISOString();
        appendLog(upLog, '\n=== ' + upStarted + ' 升级: ' + upExe + ' ' + upArgs.join(' ') + '\n');
        let upChild;
        try {
          upChild = spawn(upExe, upArgs, {
            cwd: item.cwd && fs.existsSync(item.cwd) ? item.cwd : undefined,
            env: Object.assign({}, process.env, item.env || {}),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
        upChild.stdout.on('data', (b) => appendLog(upLog, b.toString('utf8')));
        upChild.stderr.on('data', (b) => appendLog(upLog, b.toString('utf8')));
        upChild.on('error', (e) => appendLog(upLog, '\n[升级启动失败] ' + e.message + '\n'));
        upChild.on('exit', (code, sig) => {
          const upEnded = new Date().toISOString();
          appendLog(upLog, '\n=== 升级结束 code=' + code + ' signal=' + sig + '\n');
          recordRun(item.id, { kind: 'upgrade', runId: upRunId, startedAt: upStarted, endedAt: upEnded, durationMs: Date.parse(upEnded) - Date.parse(upStarted), exitCode: code, signal: sig || null, ok: code === 0, logPath: upLog });
          versionCache.delete(item.id);
        });
        return json(res, 200, { ok: true, runId: upRunId });
      }
      if (action === 'check') {
        const s = procs.get(item.id);
        if (s) { s.healthAt = 0; s.portAt = 0; }
        probeVersion(item, true);
        await probeNow(item);
        detectPorts();
        return json(res, 200, { ok: true, item: itemView(item) });
      }
    }

    m = p.match(/^\/api\/items\/([^/]+)\/runs$/);
    if (m && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      return json(res, 200, { ok: true, runs: history[id] || [] });
    }
    m = p.match(/^\/api\/items\/([^/]+)\/runs\/([^/]+)\/log$/);
    if (m && req.method === 'GET') {
      const id = decodeURIComponent(m[1]);
      const runId = decodeURIComponent(m[2]);
      const run = (history[id] || []).find((r) => r.runId === runId);
      if (!run) return json(res, 404, { ok: false, error: '没有这次运行记录' });
      return json(res, 200, { ok: true, text: tail(run.logPath, 2000) });
    }

    m = p.match(/^\/api\/items\/([^/]+)\/version$/);
    if (m && req.method === 'GET') {
      const item = findItem(decodeURIComponent(m[1]));
      if (!item) return json(res, 404, { ok: false, error: '没有这个条目' });
      if (!item.versionCmd) return json(res, 200, { ok: false, error: '该条目没有配置 versionCmd' });
      probeVersion(item, true);
      await new Promise((r) => setTimeout(r, 1500));
      const v = (versionCache.get(item.id) || {}).version || null;
      return json(res, 200, { ok: true, version: v });
    }

    if (req.method === 'POST' && p === '/api/stop-all') {
      const stopped = [], errors = [];
      for (const it of registry.items) {
        if (it.kind === 'script') continue;
        if (statusOf(it) === 'stopped') continue;
        try { await stopItem(it); stopped.push(it.id); }
        catch (e) { errors.push({ id: it.id, error: (e && e.message) || String(e) }); }
      }
      return json(res, 200, { ok: true, stopped, errors });
    }

    if (req.method === 'POST' && p === '/api/shutdown') {
      json(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 500);
      return;
    }

    if (req.method === 'POST' && p === '/api/items') {
      const raw = await readBody(req);
      const item = normalizeItem(raw);
      const exists = findItem(item.id);
      if (exists) { Object.assign(exists, item); } else { registry.items.push(item); }
      saveRegistry();
      return json(res, 200, { ok: true, item: itemView(findItem(item.id)) });
    }

    m = p.match(/^\/api\/items\/([^/]+)$/);
    if (m && req.method === 'DELETE') {
      const id = decodeURIComponent(m[1]);
      const idx = registry.items.findIndex((i) => i.id === id);
      if (idx < 0) return json(res, 404, { ok: false, error: '没有这个条目' });
      const st = procs.get(id);
      if (st) { const pid = currentPid(registry.items[idx]); if (pid) await killTree(pid); procs.delete(id); }
      registry.items.splice(idx, 1);
      saveRegistry(); saveRuntime();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/discover') {
      return json(res, 200, { ok: true, candidates: discover() });
    }

    return json(res, 404, { ok: false, error: '未知接口: ' + p });
  } catch (e) {
    return json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
  }
}

const server = http.createServer((req, res) => { handler(req, res).catch((e) => json(res, 500, { ok: false, error: String(e) })); });
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  本地控制台 已启动  ->  http://' + HOST + ':' + PORT);
  console.log('  注册表: ' + REGISTRY_PATH + '   (' + registry.items.length + ' 个条目)');
  console.log('  按 Ctrl+C 关闭（关闭后不会停掉已启动的进程）');
  console.log('');
});
process.on('SIGINT', () => { console.log('\n关闭控制台（已启动的进程保持运行）'); server.close(); process.exit(0); });
