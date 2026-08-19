import type { Story, PlaybackState, UserPreferences, ResumeAction } from "../types";

const STORY_KEY = (id: string) => `story:${id}`;
const PLAYBACK_KEY = (id: string) => `playback:${id}`;
const PREFS_KEY = "prefs";
const DEFAULT_PREFS: UserPreferences = { ttsSpeed: 1.0, volume: 1.0 };
const THROTTLE_MS = 5_000;

export async function saveStory(story: Story): Promise<void> {
  await browser.storage.local.set({ [STORY_KEY(story.id)]: story });
}

export async function loadStory(storyId: string): Promise<Story | null> {
  const result = await browser.storage.local.get(STORY_KEY(storyId));
  return (result[STORY_KEY(storyId)] as Story) ?? null;
}

export async function savePlaybackState(state: PlaybackState): Promise<void> {
  await browser.storage.local.set({ [PLAYBACK_KEY(state.storyId)]: state });
}

export async function loadPlaybackState(storyId: string): Promise<PlaybackState | null> {
  const result = await browser.storage.local.get(PLAYBACK_KEY(storyId));
  return (result[PLAYBACK_KEY(storyId)] as PlaybackState) ?? null;
}

export async function clearPlaybackState(storyId: string): Promise<void> {
  await browser.storage.local.remove(PLAYBACK_KEY(storyId));
}

export function resolveResume(
  currentUrl: string,
  state: PlaybackState | null
): ResumeAction {
  if (!state) return { type: "none" };
  if (state.currentThreadmarkUrl === currentUrl) {
    return { type: "resume-here", charOffset: state.charOffset };
  }
  return { type: "navigate", url: state.currentThreadmarkUrl };
}

export class ThrottledStateWriter {
  private readonly intervalMs: number;
  private lastWriteAt = 0;
  private pending: PlaybackState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(intervalMs = THROTTLE_MS) {
    this.intervalMs = intervalMs;
  }

  enqueue(state: PlaybackState): void {
    this.pending = state;
    const elapsed = Date.now() - this.lastWriteAt;

    if (elapsed >= this.intervalMs) {
      this.writeNow();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.writeNow();
      }, this.intervalMs - elapsed);
    }
    // else: timer already running; pending updated above — it will write on fire
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      const state = this.pending;
      this.pending = null;
      this.lastWriteAt = Date.now();
      await savePlaybackState(state);
    }
  }

  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  private writeNow(): void {
    if (!this.pending) return;
    const state = this.pending;
    this.pending = null;
    this.lastWriteAt = Date.now();
    savePlaybackState(state); // fire-and-forget; errors non-critical during playback
  }
}

export async function loadPreferences(): Promise<UserPreferences> {
  const result = await browser.storage.sync.get(PREFS_KEY);
  const saved = result[PREFS_KEY] as Partial<UserPreferences> | undefined;
  return { ...DEFAULT_PREFS, ...saved };
}

export async function savePreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const current = await loadPreferences();
  await browser.storage.sync.set({ [PREFS_KEY]: { ...current, ...prefs } });
}
