import type {
  MusicFreeMediaBase,
  MusicFreeMediaSourceResult,
  MusicFreeSearchType,
  MusicFreeUserVariable
} from "./musicfree.js";

export interface InstalledMusicFreePlugin {
  id: string;
  platform: string;
  version: string;
  filePath: string;
  sourceUrl?: string;
  srcUrl?: string;
  sha256: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  primaryKey?: string[];
  cacheControl?: string;
  supportedSearchType?: MusicFreeSearchType[];
  userVariables?: MusicFreeUserVariable[];
  userVariableValues?: Record<string, string>;
}

export interface MusicFreeSubscriptionRecord {
  id: string;
  url: string;
  desc?: string;
  installedAt: string;
  updatedAt: string;
}

export interface CandidateRecord {
  id: string;
  pluginId: string;
  type: MusicFreeSearchType;
  item: MusicFreeMediaBase;
  createdAt: string;
  query?: string;
}

export interface ResolvedMediaRecord {
  id: string;
  candidateId: string;
  quality: string;
  source: MusicFreeMediaSourceResult;
  createdAt: string;
}

export interface MusicFreeRegistryFile {
  version: 1;
  plugins: InstalledMusicFreePlugin[];
  subscriptions: MusicFreeSubscriptionRecord[];
}

export interface CandidateCacheFile {
  version: 1;
  candidates: CandidateRecord[];
  resolved: ResolvedMediaRecord[];
}
