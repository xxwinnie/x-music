import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedBridgeConfig } from "../config.js";
import type {
  CandidateCacheFile,
  CandidateRecord,
  InstalledMusicFreePlugin,
  MusicFreeRegistryFile,
  MusicFreeSubscriptionRecord,
  ResolvedMediaRecord
} from "../types/store.js";
import { assertPathInside, ensureDir, readJsonFile, slugify, writeJsonFile } from "../utils/files.js";
import { shortHash } from "../utils/hash.js";

const EMPTY_REGISTRY: MusicFreeRegistryFile = {
  version: 1,
  plugins: [],
  subscriptions: []
};

const EMPTY_CACHE: CandidateCacheFile = {
  version: 1,
  candidates: [],
  resolved: []
};

export class MusicFreeStore {
  readonly pluginsDir: string;
  private readonly registryPath: string;
  private readonly cachePath: string;

  constructor(private readonly config: ResolvedBridgeConfig) {
    this.pluginsDir = path.join(config.dataDir, "plugins");
    this.registryPath = path.join(config.dataDir, "registry.json");
    this.cachePath = path.join(config.dataDir, "cache", "candidates.json");
  }

  async ensureReady(): Promise<void> {
    await ensureDir(this.config.dataDir);
    await ensureDir(this.pluginsDir);
    await ensureDir(path.join(this.config.dataDir, "cache"));
    await ensureDir(this.config.downloadDir);
  }

  async listPlugins(): Promise<InstalledMusicFreePlugin[]> {
    const registry = await this.readRegistry();
    return registry.plugins;
  }

  async listSubscriptions(): Promise<MusicFreeSubscriptionRecord[]> {
    const registry = await this.readRegistry();
    return registry.subscriptions;
  }

  async getPlugin(pluginId: string): Promise<InstalledMusicFreePlugin> {
    const registry = await this.readRegistry();
    const plugin = registry.plugins.find((entry) => entry.id === pluginId || entry.platform === pluginId);
    if (!plugin) {
      throw new Error(`MusicFree plugin not found: ${pluginId}`);
    }
    return plugin;
  }

  async upsertPlugin(plugin: InstalledMusicFreePlugin): Promise<InstalledMusicFreePlugin> {
    const registry = await this.readRegistry();
    const index = registry.plugins.findIndex(
      (entry) => entry.id === plugin.id || entry.platform === plugin.platform
    );

    const nextPlugins =
      index >= 0
        ? registry.plugins.map((entry, current) => (current === index ? plugin : entry))
        : [...registry.plugins, plugin];

    await this.writeRegistry({ ...registry, plugins: nextPlugins });
    return plugin;
  }

  async setPluginVariables(
    pluginId: string,
    values: Record<string, string>
  ): Promise<InstalledMusicFreePlugin> {
    const registry = await this.readRegistry();
    const plugin = registry.plugins.find((entry) => entry.id === pluginId || entry.platform === pluginId);
    if (!plugin) {
      throw new Error(`MusicFree plugin not found: ${pluginId}`);
    }

    const allowedKeys = new Set(plugin.userVariables?.map((item) => item.key) ?? []);
    const filtered = Object.fromEntries(
      Object.entries(values).filter(([key]) => allowedKeys.size === 0 || allowedKeys.has(key))
    );

    const updated = {
      ...plugin,
      userVariableValues: {
        ...(plugin.userVariableValues ?? {}),
        ...filtered
      },
      updatedAt: new Date().toISOString()
    };

    await this.upsertPlugin(updated);
    return updated;
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<InstalledMusicFreePlugin> {
    const registry = await this.readRegistry();
    const plugin = registry.plugins.find((entry) => entry.id === pluginId || entry.platform === pluginId);
    if (!plugin) {
      throw new Error(`MusicFree plugin not found: ${pluginId}`);
    }

    const updated = {
      ...plugin,
      enabled,
      updatedAt: new Date().toISOString()
    };

    await this.upsertPlugin(updated);
    return updated;
  }

  async removePlugin(pluginId: string, deleteFiles: boolean): Promise<InstalledMusicFreePlugin> {
    const registry = await this.readRegistry();
    const plugin = registry.plugins.find((entry) => entry.id === pluginId || entry.platform === pluginId);
    if (!plugin) {
      throw new Error(`MusicFree plugin not found: ${pluginId}`);
    }

    const plugins = registry.plugins.filter((entry) => entry.id !== plugin.id);
    await this.writeRegistry({ ...registry, plugins });

    if (deleteFiles) {
      const pluginDir = assertPathInside(this.pluginsDir, path.dirname(plugin.filePath));
      await fs.rm(pluginDir, { recursive: true, force: true });
    }

    return plugin;
  }

  async upsertSubscription(record: MusicFreeSubscriptionRecord): Promise<void> {
    const registry = await this.readRegistry();
    const index = registry.subscriptions.findIndex((entry) => entry.id === record.id || entry.url === record.url);
    const next =
      index >= 0
        ? registry.subscriptions.map((entry, current) => (current === index ? record : entry))
        : [...registry.subscriptions, record];
    await this.writeRegistry({ ...registry, subscriptions: next });
  }

  async writePluginFile(platform: string, source: string): Promise<string> {
    const id = uniquePluginId(platform, source);
    const pluginDir = path.join(this.pluginsDir, id);
    await ensureDir(pluginDir);
    const filePath = path.join(pluginDir, "plugin.js");
    await fs.writeFile(filePath, source, "utf8");
    return filePath;
  }

  async saveCandidate(record: CandidateRecord): Promise<void> {
    const cache = await this.readCache();
    const candidates = [record, ...cache.candidates.filter((entry) => entry.id !== record.id)].slice(0, 500);
    await this.writeCache({ ...cache, candidates });
  }

  async getCandidate(candidateId: string): Promise<CandidateRecord> {
    const cache = await this.readCache();
    const candidate = cache.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) {
      throw new Error(`MusicFree candidate not found: ${candidateId}`);
    }
    return candidate;
  }

  async saveResolved(record: ResolvedMediaRecord): Promise<void> {
    const cache = await this.readCache();
    const resolved = [record, ...cache.resolved.filter((entry) => entry.id !== record.id)].slice(0, 500);
    await this.writeCache({ ...cache, resolved });
  }

  async getResolved(resolvedId: string): Promise<ResolvedMediaRecord> {
    const cache = await this.readCache();
    const resolved = cache.resolved.find((entry) => entry.id === resolvedId);
    if (!resolved) {
      throw new Error(`MusicFree resolved media not found: ${resolvedId}`);
    }
    return resolved;
  }

  async makePluginId(platform: string): Promise<string> {
    const base = slugify(platform);
    const registry = await this.readRegistry();
    if (!registry.plugins.some((entry) => entry.id === base)) {
      return base;
    }
    return `${base}-${shortHash(platform)}`;
  }

  private async readRegistry(): Promise<MusicFreeRegistryFile> {
    return readJsonFile(this.registryPath, EMPTY_REGISTRY);
  }

  private async writeRegistry(registry: MusicFreeRegistryFile): Promise<void> {
    await writeJsonFile(this.registryPath, registry);
  }

  private async readCache(): Promise<CandidateCacheFile> {
    return readJsonFile(this.cachePath, EMPTY_CACHE);
  }

  private async writeCache(cache: CandidateCacheFile): Promise<void> {
    await writeJsonFile(this.cachePath, cache);
  }
}

function uniquePluginId(platform: string, source: string): string {
  return `${slugify(platform)}-${shortHash(source)}`;
}
