# OpenClaw MusicFree Bridge

OpenClaw MusicFree Bridge is a tool plugin that runs user-installed
MusicFree-compatible plugins from OpenClaw.

This project does not ship music sources, recommend sources, bypass access
controls, or modify third-party services. It only provides a compatibility
layer between the MusicFree plugin protocol and OpenClaw tools. Users are
responsible for selecting and configuring their own plugins and sources.

## Current scope

- Install a MusicFree plugin from a local `.js` file or remote URL.
- Install plugins from a MusicFree-style `plugins.json` subscription.
- Refresh subscriptions.
- List, enable, disable, remove, and configure installed plugins.
- Call `search`, `getMediaSource`, and `getLyric`.
- Download resolved audio URLs with plugin-provided headers/user-agent.

## Package layout

```text
src/
  index.ts                 OpenClaw tool plugin entry.
  config.ts                Runtime config defaults.
  services/                Tool orchestration.
  store/                   Local plugin registry and candidate cache.
  runtime/                 MusicFree CommonJS compatibility runtime.
  types/                   MusicFree protocol types.
  utils/                   File, hash, HTTP, and quality helpers.
skills/
  musicfree/SKILL.md       Optional OpenClaw skill instructions.
```

## Build

```bash
npm install
npm run build
npm test
npm run plugin:build
npm run plugin:validate
```

Use `npm run verify` before packaging. It runs the TypeScript build, service
tests, OpenClaw metadata check, and OpenClaw plugin validation.

## OpenClaw tools

```text
musicfree_subscribe
musicfree_refresh_subscriptions
musicfree_install_plugin
musicfree_list_plugins
musicfree_set_plugin_vars
musicfree_set_plugin_enabled
musicfree_remove_plugin
musicfree_search
musicfree_resolve
musicfree_download
musicfree_lyrics
```

## MusicFree compatibility

The runtime loads CommonJS-style MusicFree plugins and currently supports the
core plugin surface needed for search and download:

- `platform`, `version`, `srcUrl`, `primaryKey`, `cacheControl`
- `supportedSearchType`
- `userVariables` through `env.getUserVariables()`
- `search(query, page, type)`
- `getMediaSource(mediaItem, quality)`
- `getLyric(musicItem)`

The compatibility runtime allows the same built-in packages MusicFree documents
for common plugins: `axios`, `crypto-js`, `dayjs`, `big-integer`, `qs`, `he`,
`cheerio`, and `webdav`.

## Local data

By default, plugin data is stored under `~/.openclaw/musicfree`:

```text
registry.json
plugins/<plugin-id>/plugin.js
cache/candidates.json
```

Downloaded files are written to `~/Music/OpenClaw` unless `downloadDir` is
configured. Each download also writes a `.openclaw-musicfree.json` sidecar with
the candidate and resolved media metadata.

## OpenClaw config example

```json5
{
  plugins: {
    entries: {
      "musicfree-bridge": {
        enabled: true,
        config: {
          dataDir: "~/.openclaw/musicfree",
          downloadDir: "~/Music/OpenClaw",
          defaultQuality: "standard",
          allowRemotePluginInstall: true
        }
      }
    }
  }
}
```

## Safety note

MusicFree plugins are executable JavaScript. Treat third-party plugins as
untrusted code unless you have reviewed them. This bridge starts with a
restricted CommonJS runtime, but the compatibility target is still arbitrary
plugin code.
