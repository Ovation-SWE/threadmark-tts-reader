const MAX_CHUNK_CHARS = 190;
const MAX_RETRIES = 3;
const TTS_BASE_URL = "https://translate.google.com/translate_tts";

export interface TtsChunk {
  blobUrl: string;
  charOffset: number;
}

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_CHARS) {
      chunks.push(remaining.trim());
      break;
    }

    const slice = remaining.slice(0, MAX_CHUNK_CHARS);
    const spaceIdx = slice.lastIndexOf(" ");
    const splitAt = spaceIdx === -1 ? MAX_CHUNK_CHARS : spaceIdx;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

function ttsUrl(chunk: string): string {
  return `${TTS_BASE_URL}?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;
}

async function fetchBlobWithRetry(url: string): Promise<Blob> {
  let lastErr: Error = new Error("Unknown fetch error");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
    try {
      const resp = await fetch(url, {
        headers: { Referer: "https://translate.google.com/" },
      });
      if (!resp.ok) {
        lastErr = new Error(`TTS fetch failed: ${resp.status} ${resp.statusText}`);
        continue;
      }
      return await resp.blob();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr;
}

export async function* ttsChunks(text: string): AsyncGenerator<TtsChunk> {
  const chunks = chunkText(text);
  let charOffset = 0;
  let prevBlobUrl: string | null = null;

  for (const chunk of chunks) {
    if (prevBlobUrl !== null) {
      URL.revokeObjectURL(prevBlobUrl);
    }

    const blob = await fetchBlobWithRetry(ttsUrl(chunk));
    const blobUrl = URL.createObjectURL(blob);
    prevBlobUrl = blobUrl;

    yield { blobUrl, charOffset };

    // Advance by chunk length + 1 for the space boundary (approximate).
    charOffset += chunk.length + 1;
  }

  if (prevBlobUrl !== null) {
    URL.revokeObjectURL(prevBlobUrl);
  }
}
