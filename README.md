# dsh-service-hub

[![Listed on DSH Plugin Hub](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org)

**Service Hub for DeepSeek Harness** — a sidebar panel that starts, stops, restarts and
monitors the local services, one-shot scripts and terminal tools you keep on your own
machine, so you no longer have to remember where each launcher lives.

## What you get

After installing, the Harness sidebar gains a **Service** tab listing every registered
entry with live status, health, port and a quick access URL, plus **start / stop /
restart / logs / refresh** buttons and a LAN address you can open from a phone.
The panel embeds a local console UI (`http://127.0.0.1:3999`); the console itself does the
process management and persists the registry, so services keep running when the panel is
closed.

## Install

```bash
dsh plugin --profile desktop add dsh-service-hub
```

Then restart DeepSeek Harness (or reload the window) and open the **Service** tab in the sidebar.

From source (works before an npm release exists):

```bash
dsh plugin --profile desktop add github:liuhuan007/dsh-service-hub
```

## Requirements

| Requirement | Why |
|---|---|
| DeepSeek Harness 0.2.1+ with the Web/Desktop UI | Client bundle targets `platform: web` |
| [`dsh-better-sidebar`](https://www.npmjs.com/package/dsh-better-sidebar) | The panel registers a sidebar tab through its service |
| A running local console daemon at `http://127.0.0.1:3999` | This plugin is the UI shell; the daemon owns the registry and process control |

The local console daemon is a separate open tool. Without it, the tab still opens and
shows a clear "console not running" state with the path to start it.

## Permissions and external services

- The client bundle only performs `fetch` against `http://127.0.0.1:3999` (localhost).
- No telemetry, no outbound network calls, no filesystem access from the plugin itself.
- The Host side (`lib/index.js`) registers nothing and changes no Harness behaviour; all
  process control happens in the separate console daemon that the user runs.

## Compatibility

- DSH: `>=0.2.1`
- UI: Web / Desktop (sidebar tab); no effect on the TUI or headless profiles
- OS: Windows (the console daemon is PowerShell based)

## Known limitations

- Requires `dsh-better-sidebar`; without it no sidebar tab is registered.
- Panel text is currently Chinese only; locale resource files ship `meta.title` /
  `meta.description` in English and Chinese for the plugin inventory.
- The embedded console URL is fixed to `127.0.0.1:3999`.

## License

MIT