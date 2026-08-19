import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chunkText, ttsChunks } from "./ttsEngine";

describe("chunkText", () => {
  it("returns [] for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns [] for whitespace-only string", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
  });

  it("returns single chunk for text of exactly 190 chars", () => {
    const text = "a".repeat(190);
    const result = chunkText(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(190);
  });

  it("splits text with space before 190 chars into two chunks", () => {
    const text = "a".repeat(180) + " " + "b".repeat(10); // 191 chars, space at index 180
    const result = chunkText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(180));
    expect(result[1]).toBe("b".repeat(10));
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(190);
    }
  });

  it("hard-splits a word longer than 190 chars with no spaces", () => {
    const text = "a".repeat(200);
    const result = chunkText(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(190));
    expect(result[1]).toBe("a".repeat(10));
  });

  it("all chunks in result have length <= 190", () => {
    const text = ("word ".repeat(50)).trim();
    const result = chunkText(text);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(190);
    }
  });
});

describe("ttsChunks", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["mp3data"], { type: "audio/mpeg" })),
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((_blob: Blob) => `blob:mock-${Math.random()}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("yields one TtsChunk with charOffset 0 for single-chunk text", async () => {
    const gen = ttsChunks("hello world");
    const result = await gen.next();
    expect(result.done).toBe(false);
    expect(result.value.charOffset).toBe(0);
    expect(result.value.blobUrl).toMatch(/^blob:/);
    await gen.next(); // exhaust
  });

  it("yields two TtsChunks; second has charOffset > 0", async () => {
    // Create text that requires two chunks (191 chars)
    const first = "a".repeat(180);
    const second = "b".repeat(10);
    const text = `${first} ${second}`;
    const chunks: { blobUrl: string; charOffset: number }[] = [];
    for await (const chunk of ttsChunks(text)) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.charOffset).toBe(0);
    expect(chunks[1]!.charOffset).toBeGreaterThan(0);
  });

  it("revokes the previous blob URL before yielding the second chunk", async () => {
    const first = "a".repeat(180);
    const second = "b".repeat(10);
    const text = `${first} ${second}`;
    const gen = ttsChunks(text);
    const first_chunk = await gen.next();
    const firstUrl = first_chunk.value.blobUrl;
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await gen.next();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
  });

  it("revokes the last blob URL after all chunks consumed", async () => {
    const gen = ttsChunks("hello world");
    const chunk = await gen.next();
    const blobUrl = chunk.value.blobUrl;
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await gen.next(); // exhausts loop, triggers final revoke
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl);
  });

  it("retries MAX_RETRIES times on non-ok response then throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests" })
    );
    const gen = ttsChunks("hello");
    await expect(gen.next()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("includes Referer header in fetch requests", async () => {
    const gen = ttsChunks("hello world");
    await gen.next();
    await gen.next();
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Referer: "https://translate.google.com/" } })
    );
  });

  it("URL contains encodeURIComponent of the chunk text", async () => {
    const text = "hello world";
    const gen = ttsChunks(text);
    await gen.next();
    await gen.next();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(text)),
      expect.any(Object)
    );
  });

  it("yields nothing for empty text", async () => {
    const chunks: unknown[] = [];
    for await (const chunk of ttsChunks("")) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes blob URL when generator is abandoned early (stop scenario)", async () => {
    const first = "a".repeat(180);
    const second = "b".repeat(10);
    const text = `${first} ${second}`;
    const gen = ttsChunks(text);

    // Consume first chunk — gets its blob URL
    const result = await gen.next();
    const firstBlobUrl = result.value.blobUrl;

    // Abandon the generator mid-stream (simulates AudioPlayer.stop())
    await gen.return(undefined);

    // finally block should have revoked the last yielded URL
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstBlobUrl);
  });
});
