import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init } from "./index";
import type { ContentState } from "../messages";

function mockBrowserApi(stateOverrides?: Partial<ContentState>) {
  const defaultState: ContentState = {
    storyTitle: "The Metropolitan Man",
    threadmarkTitle: "Chapter 1",
    isPlaying: false,
    isPaused: false,
    errorMessage: null,
    hasNextChapter: true,
  };
  const state = { ...defaultState, ...stateOverrides };
  return {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42 }]),
      sendMessage: vi.fn().mockImplementation(
        (_tabId: number, msg: { type: string }) => {
          if (msg.type === "getState") return Promise.resolve(state);
          return Promise.resolve();
        }
      ),
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="no-story">Open a threadmark page.</div>
    <div id="story-info" style="display:none">
      <div id="story-title"></div>
      <div id="chapter-title"></div>
      <div class="controls">
        <button id="btn-play">▶ Play</button>
        <button id="btn-stop">■ Stop</button>
      </div>
      <div id="error-msg" style="display:none"></div>
    </div>
  `;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("no active tab", () => {
  it("returns without throwing, no-story remains visible", async () => {
    const api = mockBrowserApi();
    vi.mocked(api.tabs.query).mockResolvedValue([]);
    await init(api as unknown as typeof browser);
    expect(document.getElementById("no-story")?.style.display).not.toBe("none");
    expect(document.getElementById("story-info")?.style.display).toBe("none");
  });
});

describe("content script not on tab (sendMessage rejects)", () => {
  it("leaves no-story visible and story-info hidden", async () => {
    const api = mockBrowserApi();
    vi.mocked(api.tabs.sendMessage).mockRejectedValue(new Error("no receiver"));
    await init(api as unknown as typeof browser);
    expect(document.getElementById("no-story")?.style.display).not.toBe("none");
    expect(document.getElementById("story-info")?.style.display).toBe("none");
  });
});

describe("renders state from content script", () => {
  it("hides no-story and shows story-info", async () => {
    await init(mockBrowserApi() as unknown as typeof browser);
    expect(document.getElementById("no-story")?.style.display).toBe("none");
    expect(document.getElementById("story-info")?.style.display).toBe("block");
  });

  it("populates story title", async () => {
    await init(mockBrowserApi() as unknown as typeof browser);
    expect(document.getElementById("story-title")?.textContent).toBe("The Metropolitan Man");
  });

  it("populates chapter title", async () => {
    await init(mockBrowserApi() as unknown as typeof browser);
    expect(document.getElementById("chapter-title")?.textContent).toBe("Chapter 1");
  });

  it("shows play button when not playing", async () => {
    await init(mockBrowserApi() as unknown as typeof browser);
    expect(document.getElementById("btn-play")?.textContent).toBe("▶ Play");
  });
});

describe("renders isPlaying state", () => {
  it("shows pause button when playing", async () => {
    await init(mockBrowserApi({ isPlaying: true }) as unknown as typeof browser);
    expect(document.getElementById("btn-play")?.textContent).toBe("⏸ Pause");
  });
});

describe("renders errorMessage", () => {
  it("shows error element with message", async () => {
    await init(
      mockBrowserApi({ errorMessage: "TTS error — 429" }) as unknown as typeof browser
    );
    const errorEl = document.getElementById("error-msg");
    expect(errorEl?.style.display).toBe("block");
    expect(errorEl?.textContent).toContain("TTS error — 429");
  });
});

describe("play button — stopped state → sends play", () => {
  it("sends play message and updates button to pause", async () => {
    const api = mockBrowserApi();
    await init(api as unknown as typeof browser);

    document.getElementById("btn-play")?.click();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(api.tabs.sendMessage).toHaveBeenCalledWith(42, { type: "play" });
    expect(document.getElementById("btn-play")?.textContent).toBe("⏸ Pause");
  });
});

describe("play button — playing state → sends pause", () => {
  it("sends pause message when already playing", async () => {
    const api = mockBrowserApi({ isPlaying: true });
    await init(api as unknown as typeof browser);

    document.getElementById("btn-play")?.click();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(api.tabs.sendMessage).toHaveBeenCalledWith(42, { type: "pause" });
  });
});

describe("stop button sends stop", () => {
  it("sends stop message and reverts button to play", async () => {
    const api = mockBrowserApi({ isPlaying: true });
    await init(api as unknown as typeof browser);

    document.getElementById("btn-stop")?.click();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(api.tabs.sendMessage).toHaveBeenCalledWith(42, { type: "stop" });
    expect(document.getElementById("btn-play")?.textContent).toBe("▶ Play");
  });
});
