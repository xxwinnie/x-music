import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import type { MusicFreeBridgeConfig } from "./config.js";
import { MusicFreeService } from "./services/musicfree-service.js";

const Quality = Type.Union([
  Type.Literal("low"),
  Type.Literal("standard"),
  Type.Literal("high"),
  Type.Literal("super")
]);

const SearchType = Type.Union([
  Type.Literal("music"),
  Type.Literal("album"),
  Type.Literal("artist"),
  Type.Literal("sheet"),
  Type.Literal("lyric")
]);

export default defineToolPlugin({
  id: "musicfree-bridge",
  name: "MusicFree Bridge",
  description: "Runs user-installed MusicFree-compatible plugins from OpenClaw.",
  configSchema: Type.Object({
    dataDir: Type.Optional(Type.String({ description: "Directory for plugin files and metadata." })),
    downloadDir: Type.Optional(Type.String({ description: "Default directory for downloaded audio." })),
    defaultQuality: Type.Optional(Quality),
    allowRemotePluginInstall: Type.Optional(Type.Boolean()),
    runtimeTimeoutMs: Type.Optional(Type.Number()),
    downloadTimeoutMs: Type.Optional(Type.Number())
  }),
  tools: (tool) => [
    tool({
      name: "musicfree_subscribe",
      label: "MusicFree Subscribe",
      description: "Install or update plugins from a MusicFree-compatible plugins.json subscription.",
      parameters: Type.Object({
        url: Type.String({ description: "HTTP(S) URL to a MusicFree plugins.json file." }),
        force: Type.Optional(Type.Boolean({ description: "Overwrite existing plugins." }))
      }),
      async execute({ url, force }, config, context) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).subscribe(url, force, context.signal);
      }
    }),
    tool({
      name: "musicfree_refresh_subscriptions",
      label: "MusicFree Refresh Subscriptions",
      description: "Refresh all previously added MusicFree-compatible plugins.json subscriptions.",
      parameters: Type.Object({
        force: Type.Optional(Type.Boolean({ description: "Overwrite existing plugins." }))
      }),
      async execute({ force }, config, context) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).refreshSubscriptions(
          force,
          context.signal
        );
      }
    }),
    tool({
      name: "musicfree_install_plugin",
      label: "MusicFree Install Plugin",
      description: "Install one MusicFree-compatible plugin from a local .js file or remote URL.",
      parameters: Type.Object({
        source: Type.String({ description: "Local path or HTTP(S) URL to a MusicFree plugin .js file." }),
        force: Type.Optional(Type.Boolean({ description: "Overwrite an existing plugin." }))
      }),
      async execute({ source, force }, config, context) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).installPlugin({
          source,
          force,
          signal: context.signal
        });
      }
    }),
    tool({
      name: "musicfree_list_plugins",
      label: "MusicFree List Plugins",
      description: "List installed MusicFree-compatible plugins.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).listPlugins();
      }
    }),
    tool({
      name: "musicfree_set_plugin_vars",
      label: "MusicFree Set Plugin Variables",
      description: "Set userVariables for an installed MusicFree plugin.",
      parameters: Type.Object({
        pluginId: Type.String({ description: "Installed plugin id or platform name." }),
        values: Type.Record(Type.String(), Type.String())
      }),
      async execute({ pluginId, values }, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).setPluginVariables(pluginId, values);
      }
    }),
    tool({
      name: "musicfree_set_plugin_enabled",
      label: "MusicFree Set Plugin Enabled",
      description: "Enable or disable an installed MusicFree-compatible plugin.",
      parameters: Type.Object({
        pluginId: Type.String({ description: "Installed plugin id or platform name." }),
        enabled: Type.Boolean()
      }),
      async execute({ pluginId, enabled }, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).setPluginEnabled(pluginId, enabled);
      }
    }),
    tool({
      name: "musicfree_remove_plugin",
      label: "MusicFree Remove Plugin",
      description: "Remove an installed MusicFree-compatible plugin from the local registry.",
      parameters: Type.Object({
        pluginId: Type.String({ description: "Installed plugin id or platform name." }),
        deleteFiles: Type.Optional(Type.Boolean({ description: "Delete the stored plugin files." }))
      }),
      async execute({ pluginId, deleteFiles }, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).removePlugin(pluginId, deleteFiles);
      }
    }),
    tool({
      name: "musicfree_search",
      label: "MusicFree Search",
      description: "Search installed MusicFree-compatible plugins and return candidate IDs.",
      parameters: Type.Object({
        query: Type.String(),
        type: Type.Optional(SearchType),
        page: Type.Optional(Type.Number()),
        plugins: Type.Optional(Type.Array(Type.String()))
      }),
      async execute(params, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).search(params);
      }
    }),
    tool({
      name: "musicfree_resolve",
      label: "MusicFree Resolve",
      description: "Resolve a search candidate into a downloadable media URL.",
      parameters: Type.Object({
        candidateId: Type.String(),
        quality: Type.Optional(Quality)
      }),
      async execute(params, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).resolve(params);
      }
    }),
    tool({
      name: "musicfree_download",
      label: "MusicFree Download",
      description: "Download a resolved MusicFree candidate to the configured download directory.",
      parameters: Type.Object({
        candidateId: Type.Optional(Type.String()),
        resolvedId: Type.Optional(Type.String()),
        quality: Type.Optional(Quality),
        targetDir: Type.Optional(Type.String()),
        includeLyrics: Type.Optional(Type.Boolean())
      }),
      async execute(params, config, context) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).download({
          ...params,
          signal: context.signal
        });
      }
    }),
    tool({
      name: "musicfree_lyrics",
      label: "MusicFree Lyrics",
      description: "Fetch lyrics for a MusicFree search candidate.",
      parameters: Type.Object({
        candidateId: Type.String()
      }),
      async execute({ candidateId }, config) {
        return new MusicFreeService(config as MusicFreeBridgeConfig).lyrics(candidateId);
      }
    })
  ]
});
