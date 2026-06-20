import type { MusicFreeQuality } from "../config.js";

const QUALITY_ORDER: MusicFreeQuality[] = ["standard", "high", "super", "low"];

export function qualityAttempts(preferred: MusicFreeQuality): MusicFreeQuality[] {
  return [preferred, ...QUALITY_ORDER.filter((quality) => quality !== preferred)];
}
