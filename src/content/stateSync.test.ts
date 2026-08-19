import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeMockBrowser } from "../__fixtures__/mockBrowser";
import {
  saveStory,
  loadStory,
  savePlaybackState,
  loadPlaybackState,
  clearPlaybackState,
  resolveResume,
  ThrottledStateWriter,
  loadPreferences,
  savePreferences,
} from "./stateSync";
import type { Story, PlaybackState } from "../types";

const STORY: Story = {
  id: "abc123",
  title: "A Test Story",
  site: "sb",
  firstThreadmarkUrl: "https://forums.spacebattles.com/threads/test.123/reader/1/",
  lastSeenAt: 1000,
};

const STATE: PlaybackState = {
  storyId: "abc123",
  currentThreadmarkUrl: "https://forums.spacebattles.com/threads/test.123/reader/2/",
  charOffset: 42,
  updatedAt: 2000,
};

// ── saveStory / loadStory ─────────────────────────────────────────────────────

describe("saveStory / loadStory round-trip", () => {
  beforeEach(() => { vi.stubGlobal("browser", makeMockBrowser()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("saves a Story and loads it back with all fields intact", async () => {
    await saveStory(STORY);
    const loaded = await loadStory(STORY.id);
    expect(loaded).toEqual(STORY);
  });

  it("returns null for an unknown storyId", async () => {
    const loaded = await loadStory("unknown");
    expect(loaded).toBeNull();
  });
});

// ── savePlaybackState / loadPlaybackState ─────────────────────────────────────

describe("savePlaybackState / loadPlaybackState round-trip", () => {
  beforeEach(() => { vi.stubGlobal("browser", makeMockBrowser()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("saves a PlaybackState and loads it back with all fields intact", async () => {
    await savePlaybackState(STATE);
    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded).toEqual(STATE);
  });

  it("returns null for an unknown storyId", async () => {
    const loaded = await loadPlaybackState("unknown");
    expect(loaded).toBeNull();
  });
});

// ── clearPlaybackState ────────────────────────────────────────────────────────

describe("clearPlaybackState", () => {
  beforeEach(() => { vi.stubGlobal("browser", makeMockBrowser()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("state exists → after clear, loadPlaybackState returns null", async () => {
    await savePlaybackState(STATE);
    await clearPlaybackState(STATE.storyId);
    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded).toBeNull();
  });

  it("calling clear on a non-existent key does not throw", async () => {
    await expect(clearPlaybackState("never-existed")).resolves.toBeUndefined();
  });
});

// ── resolveResume ─────────────────────────────────────────────────────────────

describe("resolveResume", () => {
  it("state is null → { type: 'none' }", () => {
    expect(resolveResume("https://example.com/", null)).toEqual({ type: "none" });
  });

  it("state.currentThreadmarkUrl === currentUrl → resume-here with charOffset", () => {
    const result = resolveResume(STATE.currentThreadmarkUrl, STATE);
    expect(result).toEqual({ type: "resume-here", charOffset: STATE.charOffset });
  });

  it("state.currentThreadmarkUrl !== currentUrl → navigate to saved url", () => {
    const result = resolveResume("https://example.com/other/", STATE);
    expect(result).toEqual({ type: "navigate", url: STATE.currentThreadmarkUrl });
  });

  it("state with empty string URL treated as navigate (non-equal to any real URL)", () => {
    const stateWithEmptyUrl: PlaybackState = { ...STATE, currentThreadmarkUrl: "" };
    const result = resolveResume("https://example.com/", stateWithEmptyUrl);
    expect(result).toEqual({ type: "navigate", url: "" });
  });
});

// ── ThrottledStateWriter — throttle behaviour ─────────────────────────────────

describe("ThrottledStateWriter — throttle behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("browser", makeMockBrowser());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("first enqueue calls savePlaybackState immediately (leading edge)", async () => {
    const writer = new ThrottledStateWriter(5000);
    writer.enqueue(STATE);
    await Promise.resolve(); // flush microtasks
    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded).toEqual(STATE);
  });

  it("second enqueue within 5s does NOT call savePlaybackState again immediately", async () => {
    const writer = new ThrottledStateWriter(5000);
    writer.enqueue(STATE);
    await Promise.resolve();

    const state2: PlaybackState = { ...STATE, charOffset: 99 };
    writer.enqueue(state2);
    await Promise.resolve();

    // immediately after second enqueue, still has first write's value
    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded?.charOffset).toBe(STATE.charOffset);
  });

  it("after vi.advanceTimersByTime(5000), the pending state IS written", async () => {
    const writer = new ThrottledStateWriter(5000);
    writer.enqueue(STATE);
    await Promise.resolve();

    const state2: PlaybackState = { ...STATE, charOffset: 99 };
    writer.enqueue(state2);

    vi.advanceTimersByTime(5000);
    await Promise.resolve(); // let the timer callback + savePlaybackState settle

    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded?.charOffset).toBe(99);
  });

  it("three rapid enqueues → only the last pending value is written at trailing edge", async () => {
    const writer = new ThrottledStateWriter(5000);
    writer.enqueue(STATE); // first: written immediately (leading)
    await Promise.resolve();

    const s2: PlaybackState = { ...STATE, charOffset: 50 };
    const s3: PlaybackState = { ...STATE, charOffset: 75 };
    writer.enqueue(s2);
    writer.enqueue(s3); // s3 replaces s2 as pending

    vi.advanceTimersByTime(5000);
    await Promise.resolve();

    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded?.charOffset).toBe(75);
  });

  it("flush() cancels the pending timer and writes pending state immediately", async () => {
    const writer = new ThrottledStateWriter(5000);
    writer.enqueue(STATE);
    await Promise.resolve();

    const state2: PlaybackState = { ...STATE, charOffset: 99 };
    writer.enqueue(state2);

    // flush before timer fires
    await writer.flush();

    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded?.charOffset).toBe(99);
  });

  it("flush() with no pending state resolves without error", async () => {
    const writer = new ThrottledStateWriter(5000);
    await expect(writer.flush()).resolves.toBeUndefined();
  });

  it("destroy() cancels the timer; subsequent flush resolves without writing", async () => {
    const writer = new ThrottledStateWriter(5000);
    writer.enqueue(STATE);
    await Promise.resolve();

    const state2: PlaybackState = { ...STATE, charOffset: 99 };
    writer.enqueue(state2);

    writer.destroy();
    await writer.flush(); // should be no-op

    // only the leading-edge write (STATE) should be present, not state2
    const loaded = await loadPlaybackState(STATE.storyId);
    expect(loaded?.charOffset).toBe(STATE.charOffset);
  });
});

// ── loadPreferences / savePreferences ─────────────────────────────────────────

describe("loadPreferences / savePreferences", () => {
  beforeEach(() => { vi.stubGlobal("browser", makeMockBrowser()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("loadPreferences returns defaults when nothing saved", async () => {
    const prefs = await loadPreferences();
    expect(prefs).toEqual({ ttsSpeed: 1.0, volume: 1.0 });
  });

  it("savePreferences({ ttsSpeed: 1.5 }) → loadPreferences returns merged result", async () => {
    await savePreferences({ ttsSpeed: 1.5 });
    const prefs = await loadPreferences();
    expect(prefs).toEqual({ ttsSpeed: 1.5, volume: 1.0 });
  });

  it("partial updates do not overwrite unrelated fields", async () => {
    await savePreferences({ volume: 0.5 });
    await savePreferences({ ttsSpeed: 1.8 });
    const prefs = await loadPreferences();
    expect(prefs).toEqual({ ttsSpeed: 1.8, volume: 0.5 });
  });

  it("savePreferences({}) with empty partial does not corrupt existing preferences", async () => {
    await savePreferences({ ttsSpeed: 1.5, volume: 0.8 });
    await savePreferences({});
    const prefs = await loadPreferences();
    expect(prefs).toEqual({ ttsSpeed: 1.5, volume: 0.8 });
  });
});
