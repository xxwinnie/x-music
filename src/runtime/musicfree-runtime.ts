import fs from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import type { MusicFreeQuality } from "../config.js";
import type {
  MusicFreeMediaBase,
  MusicFreeMediaSourceResult,
  MusicFreePluginExports,
  MusicFreeSearchResult,
  MusicFreeSearchType
} from "../types/musicfree.js";

const hostRequire = createRequire(import.meta.url);
const ALLOWED_REQUIRE = new Set([
  "axios",
  "crypto-js",
  "dayjs",
  "big-integer",
  "qs",
  "he",
  "cheerio",
  "webdav"
]);

export interface RuntimePluginInfo {
  platform: string;
  version: string;
  author?: string;
  srcUrl?: string;
  primaryKey?: string[];
  cacheControl?: string;
  supportedSearchType?: MusicFreeSearchType[];
  userVariables?: Array<{ key: string; title?: string }>;
  methods: string[];
}

export interface MusicFreeRuntimeOptions {
  timeoutMs: number;
}

interface RuntimeCacheEntry {
  mtimeMs: number;
  exports: MusicFreePluginExports;
}

export class MusicFreeRuntime {
  private readonly cache = new Map<string, RuntimeCacheEntry>();

  constructor(private readonly options: MusicFreeRuntimeOptions) {}

  async inspect(
    pluginPath: string,
    userVariables: Record<string, string> = {}
  ): Promise<RuntimePluginInfo> {
    const plugin = await this.loadPlugin(pluginPath, userVariables);
    return {
      platform: String(plugin.platform ?? "unknown"),
      version: String(plugin.version ?? "0.0.0"),
      author: maybeString(plugin.author),
      srcUrl: maybeString(plugin.srcUrl),
      primaryKey: Array.isArray(plugin.primaryKey) ? plugin.primaryKey.map(String) : undefined,
      cacheControl: maybeString(plugin.cacheControl),
      supportedSearchType: isSearchTypes(plugin.supportedSearchType)
        ? plugin.supportedSearchType
        : undefined,
      userVariables: Array.isArray(plugin.userVariables)
        ? plugin.userVariables
            .filter((item) => item && typeof item.key === "string")
            .map((item) => ({ key: item.key, title: item.title }))
        : undefined,
      methods: Object.entries(plugin)
        .filter(([, value]) => typeof value === "function")
        .map(([key]) => key)
        .sort()
    };
  }

  async search(
    pluginPath: string,
    userVariables: Record<string, string>,
    query: string,
    page: number,
    type: MusicFreeSearchType
  ): Promise<MusicFreeSearchResult> {
    return this.call(pluginPath, userVariables, "search", [query, page, type]);
  }

  async getMediaSource(
    pluginPath: string,
    userVariables: Record<string, string>,
    item: MusicFreeMediaBase,
    quality: MusicFreeQuality
  ): Promise<MusicFreeMediaSourceResult | null> {
    return this.call(pluginPath, userVariables, "getMediaSource", [item, quality]);
  }

  async getLyric(
    pluginPath: string,
    userVariables: Record<string, string>,
    item: MusicFreeMediaBase
  ): Promise<unknown> {
    return this.call(pluginPath, userVariables, "getLyric", [item]);
  }

  async hasMethod(
    pluginPath: string,
    userVariables: Record<string, string>,
    method: string
  ): Promise<boolean> {
    const plugin = await this.loadPlugin(pluginPath, userVariables);
    return typeof plugin[method] === "function";
  }

  private async call<T>(
    pluginPath: string,
    userVariables: Record<string, string>,
    method: string,
    args: unknown[]
  ): Promise<T> {
    const plugin = await this.loadPlugin(pluginPath, userVariables);
    const fn = plugin[method];
    if (typeof fn !== "function") {
      throw new Error(`Plugin does not implement ${method}`);
    }
    return withTimeout(Promise.resolve(fn.apply(plugin, args)) as Promise<T>, this.options.timeoutMs);
  }

  private async loadPlugin(
    pluginPath: string,
    userVariables: Record<string, string>
  ): Promise<MusicFreePluginExports> {
    const cacheKey = `${pluginPath}:${JSON.stringify(userVariables)}`;
    const stat = await fs.stat(pluginPath);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.exports;
    }

    const code = await fs.readFile(pluginPath, "utf8");
    const moduleObject = { exports: {} as MusicFreePluginExports };
    const sandboxRequire = (specifier: string) => {
      if (!ALLOWED_REQUIRE.has(specifier)) {
        throw new Error(`MusicFree plugin attempted to require disallowed package: ${specifier}`);
      }
      return hostRequire(specifier);
    };
    const sandbox = {
      module: moduleObject,
      exports: moduleObject.exports,
      require: sandboxRequire,
      env: {
        getUserVariables: () => ({ ...userVariables })
      },
      console,
      Buffer,
      URL,
      URLSearchParams,
      TextDecoder,
      TextEncoder,
      fetch,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval
    };

    const context = vm.createContext(sandbox, {
      name: `musicfree:${pluginPath}`,
      codeGeneration: { strings: true, wasm: false }
    });
    const script = new vm.Script(code, { filename: pluginPath });
    script.runInContext(context, { timeout: this.options.timeoutMs });

    const loaded = normalizeExports(moduleObject.exports);
    this.cache.set(cacheKey, { mtimeMs: stat.mtimeMs, exports: loaded });
    return loaded;
  }
}

function normalizeExports(exportsObject: MusicFreePluginExports): MusicFreePluginExports {
  const maybeDefault = (exportsObject as { default?: MusicFreePluginExports }).default;
  if (maybeDefault && typeof maybeDefault === "object") {
    return maybeDefault;
  }
  return exportsObject;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`MusicFree plugin call timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isSearchTypes(value: unknown): value is MusicFreeSearchType[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === "music" ||
        item === "album" ||
        item === "artist" ||
        item === "sheet" ||
        item === "lyric"
    )
  );
}
