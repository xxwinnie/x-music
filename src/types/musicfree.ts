import type { MusicFreeQuality } from "../config.js";

export type MusicFreeSearchType = "music" | "album" | "artist" | "sheet" | "lyric";

export interface MusicFreeMediaBase {
  platform: string;
  id: string;
  [key: string]: unknown;
}

export interface MusicFreeMusicItem extends MusicFreeMediaBase {
  artist: string;
  title: string;
  duration?: number;
  album?: string;
  artwork?: string;
  url?: string;
  lrc?: string;
  rawLrc?: string;
}

export interface MusicFreeSearchResult<T = MusicFreeMediaBase> {
  isEnd?: boolean;
  data: T[];
}

export interface MusicFreeMediaSourceResult {
  headers?: Record<string, string>;
  userAgent?: string;
  url: string;
}

export interface MusicFreeLyricSource {
  rawLrc?: string;
  translation?: string;
}

export interface MusicFreeUserVariable {
  key: string;
  title?: string;
}

export interface MusicFreePluginExports {
  platform?: string;
  author?: string;
  version?: string;
  srcUrl?: string;
  primaryKey?: string[];
  cacheControl?: "cache" | "no-cache" | "no-store" | string;
  hints?: Record<string, string[]>;
  userVariables?: MusicFreeUserVariable[];
  supportedSearchType?: MusicFreeSearchType[];
  search?: (
    query: string,
    page: number,
    type: MusicFreeSearchType
  ) => Promise<MusicFreeSearchResult>;
  getMediaSource?: (
    mediaItem: MusicFreeMusicItem,
    quality?: MusicFreeQuality
  ) => Promise<MusicFreeMediaSourceResult | null>;
  getMusicInfo?: (musicItem: MusicFreeMusicItem) => Promise<Partial<MusicFreeMusicItem> | null>;
  getLyric?: (musicItem: MusicFreeMusicItem) => Promise<MusicFreeLyricSource | null>;
  [key: string]: unknown;
}

export interface MusicFreePluginManifestEntry {
  name: string;
  url: string;
  version?: string;
}

export interface MusicFreeSubscriptionFile {
  desc?: string;
  plugins: MusicFreePluginManifestEntry[];
}
