import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeMockBrowser } from "../__fixtures__/mockBrowser";

vi.mock("./parser");
vi.mock("./audioPlayer");
vi.mock("./ttsEngine");
vi.mock("./stateSync");

type MockPlayer = {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  currentCharOffset: ReturnType<typeof vi.fn>;
};

let mockPlayer: MockPlayer;
let capturedOptions: import("./audioPlayer").AudioPlayerOptions | null;
let capturedMessageListener: ((msg: unknown) => Promise<unknown>) | null;
let mockAssign: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  capturedMessageListener = null;
  capturedOptions = null;
  mockAssign = vi.fn();

  // Replace window.location with a stub (jsdom's assign is non-configurable)
  vi.stubGlobal("location", { href: "http://localhost/", assign: mockAssign });

  const baseMock = makeMockBrowser();
  vi.stubGlobal("browser", {
    ...baseMock,
    runtime: {
      onMessage: {
        addListener: vi.fn((fn: (msg: unknown) => Promise<unknown>) => {
          capturedMessageListener = fn;
        }),
      },
    },
  });

  mockPlayer = {
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    currentCharOffset: vi.fn().mockReturnValue(0),
  };

  const { AudioPlayer } = await import("./audioPlayer");
  vi.mocked(AudioPlayer).mockImplementation(
    function (_doc: Document, opts: import("./audioPlayer").AudioPlayerOptions) {
      capturedOptions = opts;
      return mockPlayer as unknown as import("./audioPlayer").AudioPlayer;
    } as unknown as typeof AudioPlayer
  );

  const { ttsChunks } = await import("./ttsEngine");
  vi.mocked(ttsChunks).mockReturnValue(
    (async function* () {})() as AsyncGenerator<import("./ttsEngine").TtsChunk>
  );

  const stateSync = await import("./stateSync");
  vi.mocked(stateSync.loadStory).mockResolvedValue(null);
  vi.mocked(stateSync.loadPlaybackState).mockResolvedValue(null);
  vi.mocked(stateSync.saveStory).mockResolvedValue(undefined);
  vi.mocked(stateSync.savePlaybackState).mockResolvedValue(undefined);
  vi.mocked(stateSync.clearPlaybackState).mockResolvedValue(undefined);
  vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  vi.mocked(stateSync.loadPreferences).mockResolvedValue({ ttsSpeed: 1.0, volume: 1.0 });
  vi.mocked(stateSync.ThrottledStateWriter).mockImplementation(
    class {
      enqueue = vi.fn();
      flush = vi.fn().mockResolvedValue(undefined);
      destroy = vi.fn();
    } as unknown as typeof stateSync.ThrottledStateWriter
  );

  const parser = await import("./parser");
  vi.mocked(parser.isThreadmarkPage).mockReturnValue(false);
  vi.mocked(parser.parseThreadmarkPage).mockReturnValue({
    storyId: "abc123",
    storyTitle: "Test Story",
    site: "sb",
    currentUrl: "https://forums.spacebattles.com/threads/test.123/reader/1/",
    threadmarkTitle: "Chapter 1",
    threadmarkIndex: 1,
    nextUrl: "https://forums.spacebattles.com/threads/test.123/reader/2/",
    prevUrl: null,
    bodyText: "Once upon a time.",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function runInit(): Promise<void> {
  const { init } = await import("./index");
  await init();
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("non-threadmark page", () => {
  it("returns early — no bar injected and no AudioPlayer constructed", async () => {
    const { isThreadmarkPage } = await import("./parser");
    vi.mocked(isThreadmarkPage).mockReturnValue(false);
    const { AudioPlayer } = await import("./audioPlayer");

    await runInit();

    expect(document.getElementById("threadmark-tts-bar")).toBeNull();
    expect(vi.mocked(AudioPlayer)).not.toHaveBeenCalled();
  });
});

describe("threadmark page — no saved state (resolveResume: none)", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  });

  it("injects the floating bar", async () => {
    await runInit();
    expect(document.getElementById("threadmark-tts-bar")).not.toBeNull();
  });

  it("calls saveStory with the parsed page data", async () => {
    const stateSync = await import("./stateSync");
    await runInit();
    expect(vi.mocked(stateSync.saveStory)).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc123", title: "Test Story" })
    );
  });

  it("constructs AudioPlayer", async () => {
    const { AudioPlayer } = await import("./audioPlayer");
    await runInit();
    expect(vi.mocked(AudioPlayer)).toHaveBeenCalledOnce();
  });

  it("does NOT auto-play", async () => {
    await runInit();
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  it("does NOT navigate", async () => {
    await runInit();
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe("threadmark page — resume-here", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "resume-here", charOffset: 0 });
  });

  it("calls player.play automatically", async () => {
    await runInit();
    expect(mockPlayer.play).toHaveBeenCalledOnce();
  });

  it("saves playback state before playing", async () => {
    const stateSync = await import("./stateSync");
    await runInit();
    expect(vi.mocked(stateSync.savePlaybackState)).toHaveBeenCalledWith(
      expect.objectContaining({
        currentThreadmarkUrl: "https://forums.spacebattles.com/threads/test.123/reader/1/",
        charOffset: 0,
      })
    );
  });
});

describe("threadmark page — navigate", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({
      type: "navigate",
      url: "https://forums.spacebattles.com/threads/test.123/reader/50/",
    });
  });

  it("calls location.assign with the saved URL", async () => {
    await runInit();
    expect(mockAssign).toHaveBeenCalledWith(
      "https://forums.spacebattles.com/threads/test.123/reader/50/"
    );
  });

  it("does NOT inject the bar (navigation short-circuits)", async () => {
    await runInit();
    expect(document.getElementById("threadmark-tts-bar")).toBeNull();
  });
});

describe("onExhausted — with nextUrl", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  });

  it("saves state pointing to nextUrl and navigates", async () => {
    const stateSync = await import("./stateSync");
    await runInit();

    capturedOptions?.onExhausted();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(vi.mocked(stateSync.savePlaybackState)).toHaveBeenCalledWith(
      expect.objectContaining({
        currentThreadmarkUrl: "https://forums.spacebattles.com/threads/test.123/reader/2/",
        charOffset: 0,
      })
    );
    expect(mockAssign).toHaveBeenCalledWith(
      "https://forums.spacebattles.com/threads/test.123/reader/2/"
    );
    expect(vi.mocked(stateSync.clearPlaybackState)).not.toHaveBeenCalled();
  });
});

describe("onExhausted — last chapter (no nextUrl)", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    vi.mocked(parser.parseThreadmarkPage).mockReturnValue({
      storyId: "abc123",
      storyTitle: "Test Story",
      site: "sb",
      currentUrl: "https://forums.spacebattles.com/threads/test.123/reader/1/",
      threadmarkTitle: "Chapter 1",
      threadmarkIndex: 1,
      nextUrl: null,
      prevUrl: null,
      bodyText: "The end.",
    });
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  });

  it("calls clearPlaybackState and does NOT navigate", async () => {
    const stateSync = await import("./stateSync");
    await runInit();

    capturedOptions?.onExhausted();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(vi.mocked(stateSync.clearPlaybackState)).toHaveBeenCalledWith("abc123");
    expect(mockAssign).not.toHaveBeenCalled();
  });
});

describe("onError callback", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  });

  it("shows error message in the bar", async () => {
    await runInit();

    capturedOptions?.onError(new Error("TTS fetch failed: 429"));
    await new Promise<void>((r) => setTimeout(r, 0));

    const errorEl = document.getElementById("tts-error");
    expect(errorEl?.style.display).not.toBe("none");
    expect(errorEl?.textContent).toContain("TTS fetch failed: 429");
  });
});

describe("message: getState", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  });

  it("returns current state", async () => {
    await runInit();

    const response = await capturedMessageListener?.({ type: "getState" });
    expect(response).toMatchObject({
      storyTitle: "Test Story",
      threadmarkTitle: "Chapter 1",
      isPlaying: false,
      isPaused: false,
      errorMessage: null,
    });
  });
});

describe("message: stop", () => {
  beforeEach(async () => {
    const parser = await import("./parser");
    vi.mocked(parser.isThreadmarkPage).mockReturnValue(true);
    const stateSync = await import("./stateSync");
    vi.mocked(stateSync.resolveResume).mockReturnValue({ type: "none" });
  });

  it("stops the player and clears playback state", async () => {
    const stateSync = await import("./stateSync");
    await runInit();

    await capturedMessageListener?.({ type: "stop" });

    expect(mockPlayer.stop).toHaveBeenCalled();
    expect(vi.mocked(stateSync.clearPlaybackState)).toHaveBeenCalledWith("abc123");
  });
});
