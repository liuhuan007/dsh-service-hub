# dsh-service-hub

[![Listed on DSH Plugin Hub](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org)

**Service Hub for DeepSeek Harness** — a sidebar panel that starts, stops, restarts and
monitors the local services, one-shot scripts and terminal tools you keep on your own
machine, so you no longer have to remember where each launcher lives.

## Self-contained since 0.3.0

The package ships its own **zero-dependency console daemon** (`console/`, Node standard
library only). Installing the plugin is enough: the Host side starts the daemon on
`127.0.0.1:3999` when the plugin activates, and stops it when the plugin unloads.
No external tool, no machine-specific path, nothing to download.

Registry data and logs live in `~/.dsh-service-hub/`, so upgrading or reinstalling the
plugin keeps your service list.

## What you get

The Harness sidebar gains a **Service** tab listing every registered entry with live
status, health, port and a quick access URL, plus **start / stop / restart / logs /
refresh** buttons and a LAN address you can open from a phone. Services you start keep
running when the panel is closed, because the daemon owns the process control.

## Install

```bash
dsh plugin --profile desktop add dsh-service-hub
```

Then restart DeepSeek Harness (or reload the window) and open the **Service** tab.

From source before an npm release exists:

```bash
dsh plugin --profile desktop add github:liuhuan007/dsh-service-hub
```

## Requirements

| Requirement | Why |
|---|---|
| DeepSeek Harness 0.2.1+ with the Web/Desktop UI | Client bundle targets `platform: web` |
| [`dsh-better-sidebar`](https://www.npmjs.com/package/dsh-better-sidebar) | The panel registers a sidebar tab through its service |
| Node 18+ | Runs the bundled console daemon (the desktop app ships one) |
| Windows | Process management uses PowerShell and `tasklist`/`netstat` |

Port `3999` must be free. If another console already listens there, the plugin reuses it
instead of starting a second one.

## Permissions and external services

- The client bundle only performs `fetch` against `http://127.0.0.1:3999` (localhost).
- The bundled daemon binds `127.0.0.1` only, never a public interface.
- No telemetry, no outbound network calls from the plugin itself.
- The daemon starts and stops processes that **you registered**; it does not run anything
  on its own. Each entry's command is visible in the panel and stored in
  `~/.dsh-service-hub/data/registry.json`.

## Compatibility

- DSH: `>=0.2.1`
- UI: Web / Desktop (sidebar tab); no effect on the TUI or headless profiles
- OS: Windows

## Known limitations

- The panel opens from the session header (⚙ 服务). Installing `dsh-better-sidebar` additionally adds the same panel as a left sidebar tab; it is optional.
- Panel text is currently Chinese only; `locale/` ships `meta.title` /
  `meta.description` in English and Chinese for the plugin inventory.
- Console URL is fixed to `127.0.0.1:3999`.

## Security

The bundled console listens on `127.0.0.1` only and is guarded against drive-by use:

- **No CORS headers.** Browser requests from any other origin fail at preflight, so a
  random website cannot read `/api/state` or call mutating endpoints.
- **Origin / Sec-Fetch / Host guard.** Script-initiated cross-site requests get `403`;
  top-level and iframe navigation stays allowed so the panel can embed the page.
- **Safe ids.** Entry ids are limited to `[A-Za-z0-9._-]{1,64}` and every log path is
  resolved inside the log directory, so `/api/items/<id>/logs` cannot read other files.
- **`/healthz`** exposes only `{ ok, version, pid }` plus the `X-LC-Daemon` header, which
  the Host uses to confirm it is talking to this plugin's daemon and not an unrelated
  process that happens to occupy port 3999.

The daemon can start and stop the commands **you registered**; it never runs anything on
its own. Run `npm test` to see the regression suite for these guarantees.

## Development

```bash
npm test              # security + API regression tests (node:test)
npm run sync          # copy the console implementation into console/
npm pack --dry-run    # inspect the published file list
```
## License

MIT