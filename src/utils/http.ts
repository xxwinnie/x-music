export interface FetchTextOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  const { signal, timeoutMs } = options;
  const controller = new AbortController();
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;
  const abortRelay = () => controller.abort(signal?.reason);

  if (timeoutMs) {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  if (signal?.aborted) {
    abortRelay();
  } else {
    signal?.addEventListener("abort", abortRelay, { once: true });
  }

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${url}`);
    }
    return await response.text();
  } catch (error) {
    if (timedOut) {
      throw new Error(`HTTP fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    signal?.removeEventListener("abort", abortRelay);
  }
}

export function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function extensionFromContentType(contentType: string | null): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/aac":
      return "aac";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    default:
      return undefined;
  }
}

export function extensionFromUrl(urlLike: string): string | undefined {
  try {
    const url = new URL(urlLike);
    const match = /\.([a-z0-9]{2,5})$/i.exec(url.pathname);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}
