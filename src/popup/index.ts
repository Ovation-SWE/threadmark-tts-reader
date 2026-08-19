/// <reference types="vite/client" />
import type { ContentMessage, ContentState } from "../messages";

function renderState(state: ContentState): void {
  const noStory = document.getElementById("no-story");
  const storyInfo = document.getElementById("story-info");
  if (!noStory || !storyInfo) return;

  noStory.style.display = "none";
  storyInfo.style.display = "block";

  const titleEl = document.getElementById("story-title");
  const chapterEl = document.getElementById("chapter-title");
  const playBtn = document.getElementById("btn-play");
  const errorEl = document.getElementById("error-msg");

  if (titleEl) titleEl.textContent = state.storyTitle;
  if (chapterEl) chapterEl.textContent = state.threadmarkTitle;
  if (playBtn) playBtn.textContent = state.isPlaying ? "⏸ Pause" : "▶ Play";
  if (errorEl) {
    errorEl.style.display = state.errorMessage ? "block" : "none";
    errorEl.textContent = state.errorMessage ?? "";
  }
}

export async function init(browserApi: typeof browser = browser): Promise<void> {
  const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  let state: ContentState | null = null;
  try {
    state = (await browserApi.tabs.sendMessage(
      tab.id,
      { type: "getState" } satisfies ContentMessage
    )) as ContentState;
  } catch {
    return;
  }

  renderState(state);

  document.getElementById("btn-play")?.addEventListener("click", async () => {
    if (!tab.id) return;
    const msg: ContentMessage = state?.isPlaying ? { type: "pause" } : { type: "play" };
    try {
      await browserApi.tabs.sendMessage(tab.id, msg);
      if (state) {
        state.isPlaying = !state.isPlaying;
        state.isPaused = !state.isPlaying;
        renderState(state);
      }
    } catch {
      /* tab navigated away */
    }
  });

  document.getElementById("btn-stop")?.addEventListener("click", async () => {
    if (!tab.id) return;
    try {
      await browserApi.tabs.sendMessage(
        tab.id,
        { type: "stop" } satisfies ContentMessage
      );
      if (state) {
        state.isPlaying = false;
        state.isPaused = false;
        renderState(state);
      }
    } catch {
      /* tab navigated away */
    }
  });
}

if (import.meta.env.MODE !== "test") {
  void init().catch(console.error);
}
