import type { TtsChunk } from "./ttsEngine";

export interface AudioPlayerOptions {
  onExhausted: () => void;
  onError: (err: Error) => void;
}

export class AudioPlayer {
  private readonly _audio: HTMLAudioElement;
  private readonly _options: AudioPlayerOptions;
  private _charOffset = 0;
  private _stopController: AbortController | null = null;

  constructor(doc: Document, options: AudioPlayerOptions) {
    this._audio = doc.createElement("audio");
    this._audio.preload = "auto";
    doc.body.appendChild(this._audio);
    this._options = options;

    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => { void this._audio.play(); });
      navigator.mediaSession.setActionHandler("pause", () => this.pause());
      navigator.mediaSession.setActionHandler("stop", () => this.stop());
    }
  }

  play(chunks: AsyncGenerator<TtsChunk>, metadata?: { title: string; artist: string }): void {
    this.stop();

    if (metadata && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata(metadata);
    }

    const ac = new AbortController();
    this._stopController = ac;
    this._runLoop(chunks, ac.signal).catch((err: unknown) => {
      this._options.onError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  pause(): void {
    this._audio.pause();
  }

  resume(): void {
    void this._audio.play();
  }

  stop(): void {
    this._stopController?.abort();
    this._stopController = null;
    this._audio.pause();
    this._audio.src = "";
    this._charOffset = 0;
  }

  currentCharOffset(): number {
    return this._charOffset;
  }

  private async _runLoop(chunks: AsyncGenerator<TtsChunk>, signal: AbortSignal): Promise<void> {
    try {
      for await (const chunk of chunks) {
        if (signal.aborted) return;
        this._charOffset = chunk.charOffset;
        this._audio.src = chunk.blobUrl;
        await new Promise<void>((resolve, reject) => {
          const onEnded = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("Audio playback error")); };
          const onAbort = () => { cleanup(); resolve(); };
          const cleanup = () => {
            this._audio.removeEventListener("ended", onEnded);
            this._audio.removeEventListener("error", onError);
            (signal as EventTarget).removeEventListener("abort", onAbort);
          };
          this._audio.addEventListener("ended", onEnded, { once: true });
          this._audio.addEventListener("error", onError, { once: true });
          (signal as EventTarget).addEventListener("abort", onAbort, { once: true });
          this._audio.play().catch(reject);
        });
        if (signal.aborted) return;
      }
      if (!signal.aborted) this._options.onExhausted();
    } catch (err) {
      if (!signal.aborted) {
        this._options.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
