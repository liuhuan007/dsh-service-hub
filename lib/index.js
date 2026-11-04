/**
 * dsh-service-hub — Host 侧。
 *
 * 让插件可分发：控制台守护进程随包发布（console/，纯 Node 标准库、零依赖），
 * 插件激活时自动拉起，因此任何用户装完即可用，不依赖原作者机器上的路径。
 *
 * 行为约定：
 *  - 若 127.0.0.1:3999 上已有控制台（用户自己起的），直接尊重它，不再 spawn；
 *  - 否则用当前 Node 运行时在包内拉起 console/server.mjs；
 *  - 数据与日志写到 ~/.dsh-service-hub/，卸载/升级不会丢登记表；
 *  - 插件卸载时结束自己拉起的子进程（只结束自己创建的）。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const name = 'service-hub';

const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONSOLE_ENTRY = path.join(PKG_ROOT, 'console', 'server.mjs');
const STATE_URL = 'http://127.0.0.1:3999/api/state';

function consoleIsUp() {
  return fetch(STATE_URL, { signal: AbortSignal.timeout(1200) })
    .then((r) => r.ok)
    .catch(() => false);
}

export function apply(ctx) {
  let child = null;
  let disposed = false;

  const startConsole = async () => {
    if (disposed || child || !existsSync(CONSOLE_ENTRY)) return;
    if (await consoleIsUp()) return;
    if (disposed) return;
    const home = path.join(os.homedir(), '.dsh-service-hub');
    try {
      child = spawn(process.execPath, [CONSOLE_ENTRY], {
        cwd: PKG_ROOT,
        env: {
          ...process.env,
          LC_PORT: '3999',
          LC_DATA_DIR: path.join(home, 'data'),
          LC_LOG_DIR: path.join(home, 'logs'),
        },
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => { child = null; });
      child.on('exit', () => { child = null; });
    } catch {
      child = null;
    }
  };

  ctx.effect(() => {
    startConsole();
    return () => {
      disposed = true;
      if (child && child.exitCode === null) {
        try { child.kill(); } catch { /* ignore */ }
      }
      child = null;
    };
  }, 'service-hub: console');
}