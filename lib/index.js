/**
 * dsh-service-hub — Host 侧。
 *
 * 让插件可分发：控制台守护进程随包发布（console/，纯 Node 标准库、零依赖），
 * 插件激活时自动拉起，任何用户装完即可用。
 *
 * 行为约定：
 *  - 若 127.0.0.1:3999 上已有**本插件**的控制台（/healthz 带 X-LC-Daemon 头），直接复用；
 *  - 否则用当前 Node 运行时在包内拉起 console/server.mjs，失败按退避重试；
 *  - 子进程 stdout/stderr 落到 ~/.dsh-service-hub/logs/daemon-spawn.log，端口冲突等失败可诊断；
 *  - 数据与日志写在 ~/.dsh-service-hub/，升级不会丢登记表；
 *  - 插件卸载时只结束自己创建的子进程。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const name = 'service-hub';

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONSOLE_ENTRY = path.join(PKG_ROOT, 'console', 'server.mjs');
const HOME_DIR = path.join(os.homedir(), '.dsh-service-hub');
const LOG_DIR = path.join(HOME_DIR, 'logs');
const SPAWN_LOG = path.join(LOG_DIR, 'daemon-spawn.log');
const HEALTH_URL = 'http://127.0.0.1:3999/healthz';
const MAX_ATTEMPTS = 3;

function logLine(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(SPAWN_LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch { /* 日志失败不影响主流程 */ }
}

/** 只有带 X-LC-Daemon 响应头的才是本插件的控制台，避免误认别的 3999 服务。 */
async function probeConsole() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return { up: false, reason: `healthz ${res.status}` };
    const version = res.headers.get('x-lc-daemon');
    if (!version) return { up: false, reason: 'healthz 缺少 X-LC-Daemon 头（端口被其他服务占用？）' };
    return { up: true, version };
  } catch (error) {
    return { up: false, reason: String((error && error.message) || error) };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function apply(ctx) {
  let child = null;
  let disposed = false;

  const startConsole = async () => {
    if (disposed || child) return;
    if (!existsSync(CONSOLE_ENTRY)) {
      logLine(`跳过启动：找不到 ${CONSOLE_ENTRY}`);
      return;
    }

    const first = await probeConsole();
    if (first.up) {
      logLine(`复用已有控制台 v${first.version}`);
      return;
    }
    logLine(`准备启动控制台（当前探测：${first.reason}）`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !disposed; attempt += 1) {
      if (attempt > 1) {
        const backoff = 500 * 2 ** (attempt - 1);
        logLine(`第 ${attempt} 次尝试，先等待 ${backoff}ms`);
        await sleep(backoff);
        if (disposed) return;
      }
      try {
        const spawned = spawn(process.execPath, [CONSOLE_ENTRY], {
          cwd: PKG_ROOT,
          env: {
            ...process.env,
            LC_PORT: '3999',
            LC_DATA_DIR: path.join(HOME_DIR, 'data'),
            LC_LOG_DIR: LOG_DIR,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child = spawned;
        // 子进程输出落盘，端口占用/校验失败等异常才有据可查
        spawned.stdout.on('data', (chunk) => logLine('[console] ' + String(chunk).trimEnd()));
        spawned.stderr.on('data', (chunk) => logLine('[console:err] ' + String(chunk).trimEnd()));
        spawned.on('error', (error) => {
          logLine('spawn 失败: ' + String((error && error.message) || error));
          child = null;
        });
        spawned.on('exit', (code, signal) => {
          logLine(`控制台进程退出 code=${code} signal=${signal}`);
          if (child === spawned) child = null;
        });

        for (let wait = 0; wait < 30; wait += 1) {
          await sleep(200);
          if (disposed) return;
          const probe = await probeConsole();
          if (probe.up) {
            logLine(`控制台已就绪 v${probe.version}（第 ${attempt} 次尝试成功）`);
            return;
          }
          if (child === null) break; // 进程已退出，进入下一次重试
        }
        logLine(`第 ${attempt} 次尝试未在 6s 内就绪`);
      } catch (error) {
        logLine('启动异常: ' + String((error && error.message) || error));
        child = null;
      }
    }
    logLine('控制台启动失败，已放弃；请查看本日志定位原因');
  };

  ctx.effect(() => {
    startConsole();
    return () => {
      disposed = true;
      if (child && child.exitCode === null) {
        try { child.kill(); } catch { /* ignore */ }
        logLine('插件卸载，已结束本插件拉起的控制台进程');
      }
      child = null;
    };
  }, 'service-hub: console');
}