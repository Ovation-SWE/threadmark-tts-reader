/// <reference types="vite/client" />
import { isThreadmarkPage, parseThreadmarkPage } from "./parser";
import type { ThreadmarkPage } from "./parser";
import { AudioPlayer } from "./audioPlayer";
import { ttsChunks } from "./ttsEngine";
import {
  saveStory,
  loadStory,
  loadPlaybackState,
  savePlaybackState,
  clearPlaybackState,
  resolveResume,
  ThrottledStateWriter,
  loadPreferences,
} from "./stateSync";
import type { ContentMessage, ContentState } from "../messages";

let _player: AudioPlayer | null = null;
let _writer: ThrottledStateWriter | null = null;
let _progressTimer: ReturnType<typeof setInterval> | null = null;
let _isPlaying = false;
let _isPaused = false;
let _errorMessage: string | null = null;
let _page: ThreadmarkPage | null = null;

function injectBar(storyTitle: string, threadmarkTitle: string): void {
  if (document.getElementById("threadmark-tts-bar")) return;

  const style = document.createElement("style");
  style.id = "threadmark-tts-style";
  style.textContent = `
#threadmark-tts-bar {
  position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;
  background: #1a1a2e; color: #e8e8e8; border-radius: 8px;
  padding: 10px 14px; font-family: sans-serif; font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.6); min-width: 200px; max-width: 300px;
  line-height: 1.4;
}
#tts-title { font-weight: bold; margin-bottom: 2px; }
#tts-chapter { color: #aaa; font-size: 11px; margin-bottom: 8px; }
#tts-controls { display: flex; gap: 8px; }
#tts-controls button {
  flex: 1; padding: 6px; cursor: pointer; border: none; border-radius: 4px;
  background: #333; color: #e8e8e8; font-size: 16px;
}
#tts-controls button:hover { background: #555; }
#tts-error { color: #ff6b6b; font-size: 11px; margin-top: 6px; }
`;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.id = "threadmark-tts-bar";

  const titleEl = document.createElement("div");
  titleEl.id = "tts-title";
  titleEl.textContent = storyTitle;

  const chapterEl = document.createElement("div");
  chapterEl.id = "tts-chapter";
  chapterEl.textContent = threadmarkTitle;

  const controls = document.createElement("div");
  controls.id = "tts-controls";

  const playBtn = document.createElement("button");
  playBtn.id = "tts-btn-play";
  playBtn.textContent = "▶";

  const stopBtn = document.createElement("button");
  stopBtn.id = "tts-btn-stop";
  stopBtn.textContent = "■";

  controls.appendChild(playBtn);
  controls.appendChild(stopBtn);

  const errorEl = document.createElement("div");
  errorEl.id = "tts-error";
  errorEl.style.display = "none";

  bar.appendChild(titleEl);
  bar.appendChild(chapterEl);
  bar.appendChild(controls);
  bar.appendChild(errorEl);
  document.body.appendChild(bar);

  playBtn.addEventListener("click", () => {
    if (_isPlaying) {
      void pauseAudio();
    } else if (_isPaused) {
      void handleMessage({ type: "play" });
    } else {
      void playAudio();
    }
  });

  stopBtn.addEventListener("click", () => {
    void stopAudio();
  });
}

function updateBarState(
  state: Pick<ContentState, "isPlaying" | "isPaused" | "errorMessage">
): void {
  const playBtn = document.getElementById("tts-btn-play");
  const errorEl = document.getElementById("tts-error");
  if (!playBtn || !errorEl) return;

  playBtn.textContent = state.isPlaying ? "⏸" : "▶";
  if (state.errorMessage) {
    errorEl.style.display = "block";
    errorEl.textContent = state.errorMessage;
  } else {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }
}

function startProgressTimer(): void {
  stopProgressTimer();
  _progressTimer = setInterval(() => {
    if (!_isPlaying || !_player || !_page) return;
    _writer?.enqueue({
      storyId: _page.storyId,
      currentThreadmarkUrl: _page.currentUrl,
      charOffset: _player.currentCharOffset(),
      updatedAt: Date.now(),
    });
  }, 1000);
}

function stopProgressTimer(): void {
  if (_progressTimer !== null) {
    clearInterval(_progressTimer);
    _progressTimer = null;
  }
}

async function playAudio(): Promise<void> {
  if (!_player || !_page) return;
  const prefs = await loadPreferences();
  _isPlaying = true;
  _isPaused = false;
  _errorMessage = null;
  updateBarState({ isPlaying: true, isPaused: false, errorMessage: null });
  await savePlaybackState({
    storyId: _page.storyId,
    currentThreadmarkUrl: _page.currentUrl,
    charOffset: 0,
    updatedAt: Date.now(),
  });
  _player.play(ttsChunks(_page.bodyText), {
    title: _page.storyTitle,
    artist: _page.threadmarkTitle,
  });
  startProgressTimer();
  // prefs loaded for future use; ttsSpeed/volume wiring is post-MVP
  void prefs;
}

async function pauseAudio(): Promise<void> {
  if (!_player) return;
  _isPlaying = false;
  _isPaused = true;
  stopProgressTimer();
  _player.pause();
  await _writer?.flush();
  updateBarState({ isPlaying: false, isPaused: true, errorMessage: null });
}

async function stopAudio(): Promise<void> {
  if (!_player || !_page) return;
  _isPlaying = false;
  _isPaused = false;
  stopProgressTimer();
  _player.stop();
  _writer?.destroy();
  await clearPlaybackState(_page.storyId);
  updateBarState({ isPlaying: false, isPaused: false, errorMessage: null });
}

async function handleExhausted(): Promise<void> {
  if (!_page) return;
  _isPlaying = false;
  stopProgressTimer();

  if (!_page.nextUrl) {
    _writer?.destroy();
    await clearPlaybackState(_page.storyId);
    updateBarState({ isPlaying: false, isPaused: false, errorMessage: null });
    return;
  }

  await savePlaybackState({
    storyId: _page.storyId,
    currentThreadmarkUrl: _page.nextUrl,
    charOffset: 0,
    updatedAt: Date.now(),
  });
  _writer?.destroy();
  window.location.assign(_page.nextUrl);
}

function handleMessage(msg: ContentMessage): Promise<ContentState | void> {
  switch (msg.type) {
    case "getState":
      return Promise.resolve({
        storyTitle: _page?.storyTitle ?? "",
        threadmarkTitle: _page?.threadmarkTitle ?? "",
        isPlaying: _isPlaying,
        isPaused: _isPaused,
        errorMessage: _errorMessage,
        hasNextChapter: (_page?.nextUrl ?? null) !== null,
      } satisfies ContentState);
    case "play":
      if (_isPaused && _player) {
        _isPaused = false;
        _isPlaying = true;
        _player.resume();
        startProgressTimer();
        updateBarState({ isPlaying: true, isPaused: false, errorMessage: null });
      } else if (!_isPlaying) {
        void playAudio();
      }
      return Promise.resolve();
    case "pause":
      return pauseAudio();
    case "stop":
      return stopAudio();
  }
}

export async function init(): Promise<void> {
  const url = window.location.href;
  if (!isThreadmarkPage(document, url)) return;

  const page = parseThreadmarkPage(document, url);
  _page = page;

  const existingStory = await loadStory(page.storyId);
  await saveStory({
    id: page.storyId,
    title: page.storyTitle,
    site: page.site,
    firstThreadmarkUrl: existingStory?.firstThreadmarkUrl ?? page.currentUrl,
    lastSeenAt: Date.now(),
  });

  const savedState = await loadPlaybackState(page.storyId);
  const resumeAction = resolveResume(page.currentUrl, savedState);

  if (resumeAction.type === "navigate") {
    window.location.assign(resumeAction.url);
    return;
  }

  injectBar(page.storyTitle, page.threadmarkTitle);

  _writer = new ThrottledStateWriter();
  _player = new AudioPlayer(document, {
    onExhausted: () => { void handleExhausted(); },
    onError: (err) => {
      _isPlaying = false;
      _isPaused = false;
      stopProgressTimer();
      _errorMessage = `TTS error — ${err.message}`;
      updateBarState({ isPlaying: false, isPaused: false, errorMessage: _errorMessage });
    },
  });

  browser.runtime.onMessage.addListener((msg: unknown) => {
    return handleMessage(msg as ContentMessage);
  });

  window.addEventListener("beforeunload", () => {
    _writer?.destroy();
  });

  if (resumeAction.type === "resume-here") {
    void playAudio();
  }
}

if (import.meta.env.MODE !== "test") {
  void init().catch(console.error);
}
