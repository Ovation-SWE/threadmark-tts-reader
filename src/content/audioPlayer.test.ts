import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioPlayer } from "./audioPlayer";
import type { TtsChunk } from "./ttsEngine";

// Drain the microtask queue enough times to let async generators settle.
// for-await on an async generator takes multiple ticks per iteration.
async function tick(n = 12) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function makeChunks(offsets: number[]): AsyncGenerator<TtsChunk> {
  async function* gen() {
    for (const offset of offsets) {
      yield { blobUrl: `blob:mock-${offset}`, charOffset: offset };
    }
  }
  return gen();
}

function fireEnded(el: HTMLAudioElement) {
  el.dispatchEvent(new Event("ended"));
}

// Use a fresh document per test so querySelector("audio") always finds the
// right element and events fire on the right instance.
let testDoc: Document;

beforeEach(() => {
  testDoc = document.implementation.createHTMLDocument();
  vi.spyOn(HTMLAudioElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLAudioElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makePlayer(onExhausted = vi.fn(), onError = vi.fn()) {
  return new AudioPlayer(testDoc, { onExhausted, onError });
}

function getAudio(): HTMLAudioElement {
  const el = testDoc.querySelector("audio");
  if (!el) throw new Error("No audio element found");
  return el as HTMLAudioElement;
}

describe("construction", () => {
  it("injects an <audio> element into document.body", () => {
    makePlayer();
    expect(testDoc.querySelector("audio")).not.toBeNull();
  });

  it("currentCharOffset() returns 0 initially", () => {
    const player = makePlayer();
    expect(player.currentCharOffset()).toBe(0);
  });
});

describe("play() and auto-advance", () => {
  it("plays first chunk and updates charOffset to 0", async () => {
    const player = makePlayer();

    player.play(makeChunks([0, 100]));
    await tick();

    expect(player.currentCharOffset()).toBe(0);
    expect(HTMLAudioElement.prototype.play).toHaveBeenCalled();
  });

  it("advances to second chunk and updates charOffset after first ends", async () => {
    const player = makePlayer();
    const audio = getAudio();

    player.play(makeChunks([0, 100]));
    await tick();

    fireEnded(audio);
    await tick();

    expect(player.currentCharOffset()).toBe(100);
  });

  it("calls onExhausted after all chunks end", async () => {
    const onExhausted = vi.fn();
    const player = makePlayer(onExhausted);
    const audio = getAudio();

    player.play(makeChunks([0]));
    await tick();

    fireEnded(audio);
    await tick();

    expect(onExhausted).toHaveBeenCalledOnce();
  });

  it("does not call onExhausted during playback", async () => {
    const onExhausted = vi.fn();
    const player = makePlayer(onExhausted);
    const audio = getAudio();

    player.play(makeChunks([0, 100]));
    await tick();

    fireEnded(audio); // advances to second chunk
    await tick();

    expect(onExhausted).not.toHaveBeenCalled();
  });
});

describe("pause/resume", () => {
  it("pause() calls audio.pause()", () => {
    const player = makePlayer();
    player.pause();
    expect(HTMLAudioElement.prototype.pause).toHaveBeenCalled();
  });

  it("resume() calls audio.play()", async () => {
    const player = makePlayer();
    player.resume();
    await tick();
    expect(HTMLAudioElement.prototype.play).toHaveBeenCalled();
  });

  it("currentCharOffset() is unchanged after pause", async () => {
    const player = makePlayer();

    player.play(makeChunks([42]));
    await tick();

    player.pause();
    expect(player.currentCharOffset()).toBe(42);
  });
});

describe("stop()", () => {
  it("resets currentCharOffset() to 0", async () => {
    const player = makePlayer();

    player.play(makeChunks([42]));
    await tick();

    expect(player.currentCharOffset()).toBe(42);
    player.stop();
    expect(player.currentCharOffset()).toBe(0);
  });

  it("does not call onExhausted when stop() is called mid-playback", async () => {
    const onExhausted = vi.fn();
    const player = makePlayer(onExhausted);
    const audio = getAudio();

    player.play(makeChunks([0, 100]));
    await tick();

    player.stop();
    fireEnded(audio);
    await tick();

    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("stop() before any play is a no-op", () => {
    const player = makePlayer();
    expect(() => player.stop()).not.toThrow();
    expect(player.currentCharOffset()).toBe(0);
  });

  it("playing new chunks after stop() works cleanly", async () => {
    const onExhausted = vi.fn();
    const player = makePlayer(onExhausted);
    const audio = getAudio();

    player.play(makeChunks([0, 100]));
    await tick();

    player.stop();

    player.play(makeChunks([0]));
    await tick();

    fireEnded(audio);
    await tick();

    expect(onExhausted).toHaveBeenCalledOnce();
  });
});

describe("onError", () => {
  it("calls onError when audio.play() rejects", async () => {
    const onError = vi.fn();
    const onExhausted = vi.fn();

    vi.spyOn(HTMLAudioElement.prototype, "play").mockRejectedValue(
      new Error("NotAllowedError")
    );

    const player = new AudioPlayer(testDoc, { onExhausted, onError });

    player.play(makeChunks([0]));
    await tick();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("onExhausted is NOT called when error occurs", async () => {
    const onError = vi.fn();
    const onExhausted = vi.fn();

    vi.spyOn(HTMLAudioElement.prototype, "play").mockRejectedValue(
      new Error("PlaybackError")
    );

    const player = new AudioPlayer(testDoc, { onExhausted, onError });
    player.play(makeChunks([0]));
    await tick();

    expect(onExhausted).not.toHaveBeenCalled();
  });
});
