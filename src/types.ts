import type { Site } from "./content/parser";

export interface Story {
  id: string;
  title: string;
  site: Site;
  firstThreadmarkUrl: string;
  lastSeenAt: number;
}

export interface PlaybackState {
  storyId: string;
  currentThreadmarkUrl: string;
  charOffset: number;
  updatedAt: number;
}

export interface UserPreferences {
  ttsSpeed: number;
  volume: number;
}

export type ResumeAction =
  | { type: "none" }
  | { type: "resume-here"; charOffset: number }
  | { type: "navigate"; url: string };
