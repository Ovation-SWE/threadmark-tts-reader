export type ContentMessage =
  | { type: "getState" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" };

export interface ContentState {
  storyTitle: string;
  threadmarkTitle: string;
  isPlaying: boolean;
  isPaused: boolean;
  errorMessage: string | null;
  hasNextChapter: boolean;
}
