import { homedir } from "node:os";
import path from "node:path";

export type MusicFreeQuality = "low" | "standard" | "high" | "super";

export interface MusicFreeBridgeConfig {
  dataDir?: string;
  downloadDir?: string;
  defaultQuality?: MusicFreeQuality;
  allowRemotePluginInstall?: boolean;
  runtimeTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

export interface ResolvedBridgeConfig {
  dataDir: string;
  downloadDir: string;
  defaultQuality: MusicFreeQuality;
  allowRemotePluginInstall: boolean;
  runtimeTimeoutMs: number;
  downloadTimeoutMs: number;
}

export function resolveBridgeConfig(config: MusicFreeBridgeConfig = {}): ResolvedBridgeConfig {
  return {
    dataDir: expandHome(config.dataDir ?? "~/.openclaw/musicfree"),
    downloadDir: expandHome(config.downloadDir ?? "~/Music/OpenClaw"),
    defaultQuality: config.defaultQuality ?? "standard",
    allowRemotePluginInstall: config.allowRemotePluginInstall ?? false,
    runtimeTimeoutMs: config.runtimeTimeoutMs ?? 30_000,
    downloadTimeoutMs: config.downloadTimeoutMs ?? 120_000
  };
}

export function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}
