import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MusicFreeBridgeConfig, MusicFreeQuality } from "../config.js";
import { resolveBridgeConfig } from "../config.js";
import { MusicFreeRuntime } from "../runtime/musicfree-runtime.js";
import { MusicFreeStore } from "../store/plugin-store.js";
import type {
  MusicFreeMediaBase,
  MusicFreeMediaSourceResult,
  MusicFreeSearchType,
  MusicFreeSubscriptionFile
} from "../types/musicfree.js";
import type { CandidateRecord, InstalledMusicFreePlugin } from "../types/store.js";
import { assertPathInside, ensureDir, sanitizeFileName } from "../utils/files.js";
import { extensionFromContentType, extensionFromUrl, fetchText, isHttpUrl } from "../utils/http.js";
import { qualityAttempts } from "../utils/quality.js";
import { sha256Hex, shortHash } from "../utils/hash.js";

export class MusicFreeService {
  private readonly config;
  private readonly store;
  private readonly runtime;

  constructor(rawConfig: MusicFreeBridgeConfig = {}) {
    this.config = resolveBridgeConfig(rawConfig);
    this.store = new MusicFreeStore(this.config);
    this.runtime = new MusicFreeRuntime({ timeoutMs: this.config.runtimeTimeoutMs });
  }

  async subscribe(url: string, force = false, signal?: AbortSignal): Promise<unknown> {
    await this.store.ensureReady();
    this.assertRemoteInstallAllowed(url);

    const raw = await fetchText(url, {
      signal,
      timeoutMs: this.config.pluginFetchTimeoutMs
    });
    const subscription = JSON.parse(raw) as MusicFreeSubscriptionFile;
    if (!subscription || !Array.isArray(subscription.plugins)) {
      throw new Error("Invalid MusicFree subscription: expected plugins array");
    }

    const installed = [];
    const errors = [];
    for (const entry of subscription.plugins) {
      try {
        installed.push(await this.installPlugin({ source: entry.url, force, signal }));
      } catch (error) {
        errors.push({
          name: entry.name,
          url: entry.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const now = new Date().toISOString();
    await this.store.upsertSubscription({
      id: shortHash(url),
      url,
      desc: subscription.desc,
      installedAt: now,
      updatedAt: now
    });

    return { desc: subscription.desc, installed, errors };
  }

  async refreshSubscriptions(force = false, signal?: AbortSignal): Promise<unknown> {
    await this.store.ensureReady();
    const subscriptions = await this.store.listSubscriptions();
    const refreshed = [];
    const errors = [];

    for (const subscription of subscriptions) {
      try {
        refreshed.push(await this.subscribe(subscription.url, force, signal));
      } catch (error) {
        errors.push({
          url: subscription.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { count: subscriptions.length, refreshed, errors };
  }

  async listSubscriptions() {
    await this.store.ensureReady();
    return this.store.listSubscriptions();
  }

  async removeSubscription(subscriptionIdOrUrl: string) {
    await this.store.ensureReady();
    return this.store.removeSubscription(subscriptionIdOrUrl);
  }

  async installPlugin(options: {
    source: string;
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<InstalledMusicFreePlugin> {
    await this.store.ensureReady();
    const sourceCode = await this.readPluginSource(options.source, options.signal);
    const sha256 = sha256Hex(sourceCode);
    const info = await this.inspectPluginSource(sourceCode);
    const platform = info.platform && info.platform !== "unknown" ? info.platform : `plugin-${sha256.slice(0, 8)}`;

    const existing = (await this.store.listPlugins()).find((entry) => entry.platform === platform);
    const pluginId = existing?.id ?? (await this.store.makePluginId(platform));
    if (existing && !options.force && compareSemverLike(info.version, existing.version) < 0) {
      throw new Error(
        `Refusing to install older plugin ${platform} ${info.version}; installed version is ${existing.version}`
      );
    }

    const pluginDir = path.join(this.store.pluginsDir, pluginId);
    await ensureDir(pluginDir);
    const finalPath = path.join(pluginDir, "plugin.js");
    await fs.writeFile(finalPath, sourceCode, "utf8");

    const now = new Date().toISOString();
    const record: InstalledMusicFreePlugin = {
      id: pluginId,
      platform,
      version: info.version,
      filePath: finalPath,
      sourceUrl: isHttpUrl(options.source) ? options.source : undefined,
      srcUrl: info.srcUrl,
      sha256,
      enabled: existing?.enabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      primaryKey: info.primaryKey,
      cacheControl: info.cacheControl,
      supportedSearchType: info.supportedSearchType,
      userVariables: info.userVariables,
      userVariableValues: existing?.userVariableValues ?? {}
    };

    await this.store.upsertPlugin(record);
    return record;
  }

  async listPlugins(): Promise<InstalledMusicFreePlugin[]> {
    await this.store.ensureReady();
    return this.store.listPlugins();
  }

  async setPluginVariables(
    pluginId: string,
    values: Record<string, string>
  ): Promise<InstalledMusicFreePlugin> {
    await this.store.ensureReady();
    return this.store.setPluginVariables(pluginId, values);
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<InstalledMusicFreePlugin> {
    await this.store.ensureReady();
    return this.store.setPluginEnabled(pluginId, enabled);
  }

  async removePlugin(pluginId: string, deleteFiles = true): Promise<InstalledMusicFreePlugin> {
    await this.store.ensureReady();
    return this.store.removePlugin(pluginId, deleteFiles);
  }

  async search(options: {
    query: string;
    type?: MusicFreeSearchType;
    page?: number;
    plugins?: string[];
  }): Promise<unknown> {
    await this.store.ensureReady();
    const type = options.type ?? "music";
    const page = options.page ?? 1;
    const plugins = await this.selectedPlugins(options.plugins, type);
    const candidates = [];
    const errors = [];

    for (const plugin of plugins) {
      try {
        if (!(await this.runtime.hasMethod(plugin.filePath, plugin.userVariableValues ?? {}, "search"))) {
          continue;
        }
        const result = await this.runtime.search(
          plugin.filePath,
          plugin.userVariableValues ?? {},
          options.query,
          page,
          type
        );
        const data = Array.isArray(result?.data) ? result.data : [];
        for (const rawItem of data) {
          const item = { ...rawItem, platform: plugin.platform } as MusicFreeMediaBase;
          const record: CandidateRecord = {
            id: randomUUID(),
            pluginId: plugin.id,
            type,
            item,
            createdAt: new Date().toISOString(),
            query: options.query
          };
          await this.store.saveCandidate(record);
          candidates.push(toCandidateSummary(record));
        }
      } catch (error) {
        errors.push({
          plugin: plugin.platform,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { query: options.query, type, page, candidates, errors };
  }

  async resolve(options: {
    candidateId: string;
    quality?: MusicFreeQuality;
  }): Promise<unknown> {
    await this.store.ensureReady();
    const candidate = await this.store.getCandidate(options.candidateId);
    const plugin = await this.store.getPlugin(candidate.pluginId);
    const quality = options.quality ?? this.config.defaultQuality;
    const source = await this.resolveSource(candidate, plugin, quality);
    const resolvedId = randomUUID();

    await this.store.saveResolved({
      id: resolvedId,
      candidateId: candidate.id,
      quality,
      source,
      createdAt: new Date().toISOString()
    });

    return {
      resolvedId,
      candidate: toCandidateSummary(candidate),
      quality,
      source: redactSourceForOutput(source)
    };
  }

  async lyrics(candidateId: string): Promise<unknown> {
    await this.store.ensureReady();
    const candidate = await this.store.getCandidate(candidateId);
    const plugin = await this.store.getPlugin(candidate.pluginId);
    if (!(await this.runtime.hasMethod(plugin.filePath, plugin.userVariableValues ?? {}, "getLyric"))) {
      return { candidate: toCandidateSummary(candidate), lyric: null };
    }
    const lyric = await this.runtime.getLyric(
      plugin.filePath,
      plugin.userVariableValues ?? {},
      candidate.item
    );
    return { candidate: toCandidateSummary(candidate), lyric };
  }

  async download(options: {
    candidateId?: string;
    resolvedId?: string;
    quality?: MusicFreeQuality;
    targetDir?: string;
    includeLyrics?: boolean;
    signal?: AbortSignal;
  }): Promise<unknown> {
    await this.store.ensureReady();
    const { candidate, source, quality } = await this.resolveDownloadInput(options);
    const targetDir = this.resolveTargetDir(options.targetDir);
    await ensureDir(targetDir);

    const downloadRequest = await this.fetchWithTimeout(source, options.signal);
    const response = downloadRequest.response;
    const ext =
      extensionFromContentType(response.headers.get("content-type")) ??
      extensionFromUrl(source.url) ??
      "mp3";
    const fileName = makeAudioFileName(candidate.item, ext);
    const finalPath = await this.resolveAvailableDownloadPath(targetDir, fileName);

    let outputOpened = false;

    try {
      if (!response.body) {
        throw new Error("Download response did not include a body");
      }
      const output = createWriteStream(finalPath, { flags: "wx" });
      output.once("open", () => {
        outputOpened = true;
      });
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        output
      );
    } catch (error) {
      if (outputOpened) {
        await fs.rm(finalPath, { force: true });
      }
      throw error;
    } finally {
      downloadRequest.cleanup();
    }

    let lyricPath: string | undefined;
    if (options.includeLyrics) {
      const lyric = await this.lyrics(candidate.id);
      const rawLrc = extractRawLrc(lyric);
      if (rawLrc) {
        lyricPath = finalPath.replace(/\.[^.]+$/, ".lrc");
        await fs.writeFile(lyricPath, rawLrc, "utf8");
      }
    }

    const sidecarPath = `${finalPath}.openclaw-musicfree.json`;
    await fs.writeFile(
      sidecarPath,
      `${JSON.stringify(
        {
          candidate,
          source: redactSourceForOutput(source),
          quality,
          downloadedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    return {
      path: finalPath,
      lyricPath,
      sidecarPath,
      candidate: toCandidateSummary(candidate),
      quality
    };
  }

  private async resolveSource(
    candidate: CandidateRecord,
    plugin: InstalledMusicFreePlugin,
    preferredQuality: MusicFreeQuality
  ): Promise<MusicFreeMediaSourceResult> {
    if (await this.runtime.hasMethod(plugin.filePath, plugin.userVariableValues ?? {}, "getMediaSource")) {
      for (const quality of qualityAttempts(preferredQuality)) {
        const source = await this.runtime.getMediaSource(
          plugin.filePath,
          plugin.userVariableValues ?? {},
          candidate.item,
          quality
        );
        if (source?.url) {
          return source;
        }
      }
    }

    if (typeof candidate.item.url === "string" && candidate.item.url) {
      return { url: candidate.item.url };
    }

    throw new Error(`Candidate ${candidate.id} did not resolve to a media URL`);
  }

  private async resolveDownloadInput(options: {
    candidateId?: string;
    resolvedId?: string;
    quality?: MusicFreeQuality;
  }): Promise<{ candidate: CandidateRecord; source: MusicFreeMediaSourceResult; quality: MusicFreeQuality }> {
    if (options.resolvedId) {
      const resolved = await this.store.getResolved(options.resolvedId);
      const candidate = await this.store.getCandidate(resolved.candidateId);
      return { candidate, source: resolved.source, quality: resolved.quality as MusicFreeQuality };
    }

    if (!options.candidateId) {
      throw new Error("musicfree_download requires either candidateId or resolvedId");
    }

    const candidate = await this.store.getCandidate(options.candidateId);
    const plugin = await this.store.getPlugin(candidate.pluginId);
    const quality = options.quality ?? this.config.defaultQuality;
    const source = await this.resolveSource(candidate, plugin, quality);
    return { candidate, source, quality };
  }

  private async selectedPlugins(
    requested: string[] | undefined,
    type: MusicFreeSearchType
  ): Promise<InstalledMusicFreePlugin[]> {
    const all = (await this.store.listPlugins()).filter((plugin) => plugin.enabled);
    const selected = requested?.length
      ? all.filter((plugin) => requested.includes(plugin.id) || requested.includes(plugin.platform))
      : all;

    return selected.filter(
      (plugin) => !plugin.supportedSearchType?.length || plugin.supportedSearchType.includes(type)
    );
  }

  private async readPluginSource(source: string, signal?: AbortSignal): Promise<string> {
    if (isHttpUrl(source)) {
      this.assertRemoteInstallAllowed(source);
      return fetchText(source, {
        signal,
        timeoutMs: this.config.pluginFetchTimeoutMs
      });
    }
    return fs.readFile(source, "utf8");
  }

  private async inspectPluginSource(sourceCode: string) {
    const tempDir = await fs.mkdtemp(path.join(this.config.dataDir, "tmp-plugin-"));
    const provisionalPath = path.join(tempDir, "plugin.js");
    try {
      await fs.writeFile(provisionalPath, sourceCode, "utf8");
      return await this.runtime.inspect(provisionalPath);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private assertRemoteInstallAllowed(source: string): void {
    if (isHttpUrl(source) && !this.config.allowRemotePluginInstall) {
      throw new Error("Remote MusicFree plugin install is disabled by config");
    }
  }

  private resolveTargetDir(targetDir?: string): string {
    if (!targetDir) {
      return this.config.downloadDir;
    }
    const requested = path.isAbsolute(targetDir)
      ? targetDir
      : path.join(this.config.downloadDir, targetDir);
    return assertPathInside(this.config.downloadDir, requested);
  }

  private async fetchWithTimeout(
    source: MusicFreeMediaSourceResult,
    signal?: AbortSignal
  ): Promise<{ response: Response; cleanup: () => void }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.downloadTimeoutMs);
    const abortRelay = () => controller.abort();
    signal?.addEventListener("abort", abortRelay, { once: true });
    try {
      const headers = new Headers(source.headers ?? {});
      if (source.userAgent && !headers.has("user-agent")) {
        headers.set("user-agent", source.userAgent);
      }
      const response = await fetch(source.url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while downloading media`);
      }
      return {
        response,
        cleanup: () => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abortRelay);
        }
      };
    } catch (error) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortRelay);
      throw error;
    }
  }

  private async resolveAvailableDownloadPath(targetDir: string, fileName: string): Promise<string> {
    const parsed = path.parse(fileName);
    for (let index = 0; index < 1_000; index += 1) {
      const suffix = index === 0 ? "" : ` (${index + 1})`;
      const candidate = assertPathInside(
        targetDir,
        path.join(targetDir, `${parsed.name}${suffix}${parsed.ext}`)
      );
      if (!(await pathExists(candidate))) {
        return candidate;
      }
    }

    throw new Error(`Could not find an available file name for ${fileName}`);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function toCandidateSummary(record: CandidateRecord): Record<string, unknown> {
  const item = record.item;
  return {
    candidateId: record.id,
    pluginId: record.pluginId,
    platform: item.platform,
    type: record.type,
    id: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album,
    duration: item.duration,
    artwork: item.artwork
  };
}

function redactSourceForOutput(source: MusicFreeMediaSourceResult): Record<string, unknown> {
  return {
    url: source.url,
    hasHeaders: Boolean(source.headers && Object.keys(source.headers).length > 0),
    hasUserAgent: Boolean(source.userAgent)
  };
}

function makeAudioFileName(item: MusicFreeMediaBase, ext: string): string {
  const artist = typeof item.artist === "string" ? item.artist : "Unknown Artist";
  const title = typeof item.title === "string" ? item.title : String(item.id ?? "Untitled");
  return `${sanitizeFileName(`${artist} - ${title}`)}.${ext}`;
}

function extractRawLrc(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const lyric = (result as { lyric?: unknown }).lyric;
  if (!lyric || typeof lyric !== "object") {
    return undefined;
  }
  const rawLrc = (lyric as { rawLrc?: unknown }).rawLrc;
  return typeof rawLrc === "string" ? rawLrc : undefined;
}

function compareSemverLike(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
