# Architecture — Threadmark TTS Reader

## Problem & Goals

A Firefox extension (desktop + Android) that reads serialized web fiction on SB/SV/QQ threadmark-by-threadmark, hands-free, without stopping at chapter boundaries or dying when the phone is backgrounded. Core promise: hit play once, put the phone down, and the story reads itself through.

---

## Approaches Considered

**A — Audio blob + Media Session API (chosen)**
Content script fetches TTS audio as MP3 blobs, plays them through a real `<audio>` element injected into the page, and registers with the Media Session API so the OS treats it as a media player (same mechanism as YouTube/Spotify). Firefox for Android respects this and keeps audio alive when backgrounded. Pre-fetches the next threadmark's audio while the current one plays so chapter transitions are seamless.

**B — Background service worker + message passing**
Service worker coordinates state; content script extracts text and passes it up. Adds architectural complexity without solving the mobile problem — audio must play in a page context, not a service worker, so you still need the `<audio>` element in the page. Same mobile survival mechanism, more moving parts. Not worth it for MVP.

**C — Tab navigation per chapter**
Extension navigates the actual tab to the next threadmark URL when a chapter ends. Simple but causes a visible page reload on every chapter boundary — breaks immersion and may trigger rate limiting. Ruled out.

---

## Recommended Approach

Option A. A content script injected on SB/SV/QQ pages owns everything: parsing the threadmark DOM, fetching TTS audio blobs from Google Translate, playing them through an `<audio>` element registered with Media Session API, and persisting playback state to `browser.storage.local` continuously. A lightweight background script holds no audio — it handles cross-tab state coordination and storage writes when the content script needs to offload them. A small popup provides play/pause/stop.

---

## Key Decisions

### Stack & Libraries

- **Language:** TypeScript — extension APIs have complex callback/promise patterns where types catch subtle bugs early.
- **Build:** Vite + `vite-plugin-web-extension` — handles the manifest, content script injection, and asset pipeline with minimal config. Fast reloads during development.
- **Manifest version:** MV2 — Firefox for Android (GeckoView/Fenix) supports MV2 reliably. MV3 support on mobile is still maturing; MV2's persistent background page also simplifies in-memory queue state. Migrate to MV3 when Chrome support is added.
- **UI framework:** None — the popup is simple enough (play/pause/stop + current chapter name) that vanilla DOM manipulation is fine. No React/Preact overhead for ~50 lines of UI.
- **No external npm dependencies beyond dev tooling** — keeps the extension small and auditable.

**Alternatives considered:** Plain JS (no build step) — viable but loses type safety on extension APIs, which are a common source of subtle bugs. Preact for popup — overkill for this UI surface.

### TTS Engine

**Google Translate TTS** (same endpoint ReadAloud uses):
```
GET https://translate.google.com/translate_tts
  ?ie=UTF-8&q={encoded_text}&tl=en&client=tw-ob&ttsspeed=1
```
Returns an MP3. Text is chunked at ~190 characters, split at word boundaries. Each chunk is fetched as a blob, converted to a blob URL, and queued on the `<audio>` element. For a single user listening at speech pace, request cadence is well within Google's tolerance — the CAPTCHA risk is a scale concern, not a single-user concern.

**Why not Web Speech API for MVP:** `SpeechSynthesis` outputs directly to the browser audio pipeline — it doesn't produce a blob, so it can't feed a real `<audio>` element, which means no Media Session API registration, which means it won't survive mobile backgrounding. Incompatible with Option A. Web Speech API can be offered as a post-MVP fallback for offline use.

### Data Model

Four entities, all stored in `browser.storage.local` (10 MB limit, sufficient for MVP):

```
Story {
  id: string            // hash of the first threadmark URL
  title: string
  site: "sb" | "sv" | "qq"
  firstThreadmarkUrl: string
  lastSeenAt: number    // timestamp
}

Threadmark {
  url: string           // primary key
  storyId: string
  title: string
  index: number         // ordinal position in the story
  nextUrl: string | null
  prevUrl: string | null
}

PlaybackState {
  storyId: string       // one active state per story
  currentThreadmarkUrl: string
  charOffset: number    // character position within the threadmark text
  updatedAt: number
}

// Post-MVP: History, Favorite — same storage, same shape
```

`browser.storage.sync` holds user preferences (voice speed, TTS engine choice) — syncs across devices, 100 KB limit is fine for settings.

IndexedDB is not needed for MVP — `browser.storage.local` is sufficient until history grows large.

### Boundaries & Contracts

**Google Translate TTS endpoint:** Unofficial, no API key, no auth. Requests must include a realistic `User-Agent` header (the `fetch` in a content script sends the browser's UA automatically — no spoofing needed). Chunk size kept at ≤190 characters to avoid URL length issues.

**Content Security Policy:** SB/SV/QQ may restrict blob URLs via CSP headers. The `<audio>` element's `src` will be set to a `blob:` URL created in the content script's origin context. If site CSP blocks this, the fallback is to use an `ArrayBuffer` + Web Audio API instead of a blob URL. Flag this in the spike.

**XenForo DOM contract:** The parser targets specific XenForo selectors for threadmark content and next/prev navigation. These selectors must be validated against all three sites before shipping. Changes to XenForo versions could break parsing — the parser should fail loudly (surface an error in the UI) rather than silently skip content.

**Permissions required (manifest):**
```json
"permissions": ["storage", "tabs"],
"host_permissions": [
  "https://forums.spacebattles.com/*",
  "https://forums.sufficientvelocity.com/*",
  "https://www.questionablequesting.com/*"
]
```

**Firefox for Android installation:** Extensions must be listed on AMO or installed via a developer/custom collection. For personal use, the user enables the custom add-ons collection in Firefox for Android's developer settings and sideloads the signed or unsigned XPI. No store listing required for personal use.

### Component Shape

```
src/
  background/
    index.ts          // MV2 background page: cross-tab state, storage writes
  content/
    index.ts          // entry point injected on threadmark pages
    parser.ts         // XenForo DOM → { text, nextUrl, prevUrl, title, storyMeta }
    audioPlayer.ts    // <audio> element lifecycle, Media Session API, chunk queue
    ttsEngine.ts      // Google Translate chunking + fetch → blob URLs
    stateSync.ts      // reads/writes PlaybackState to storage, handles resume
  popup/
    index.html
    index.ts          // play/pause/stop, current chapter display
  manifest.json
```

The content script is the primary actor. The background page is thin — it mainly exists so the content script has somewhere to send storage writes that shouldn't block the audio pipeline.

---

## Missing Pieces

- **XenForo selector audit:** Must verify the exact DOM selectors for threadmark content and next/prev navigation on all three sites before building the parser. Sites may be on different XenForo versions.
- **Media Session API on GeckoView:** The API exists in Firefox for Android but behavior when truly backgrounded (screen off, app switched) is not documented for extensions. The spike validates this.
- **CSP audit:** Whether SB/SV/QQ's CSP headers allow `blob:` URLs in `<audio>` elements within a content script context. If not, the audio pipeline needs a different approach (e.g., ArrayBuffer + Web Audio API).
- **Firefox for Android sideloading flow:** The user needs a clear setup path. Either publish to AMO (even as unlisted) or document the custom collection setup. AMO unlisted is probably the cleanest path.

---

## Spikes & Experiments

### Spike 1 — Mobile background audio survival (run before building anything else)

```
Question:      Does an <audio> element with a blob URL + Media Session API registration
               keep playing in a Firefox for Android content script when the app is backgrounded?

Spike:         Write a ~30-line content script that fetches a Google Translate TTS blob,
               plays it through an <audio> element, registers a Media Session action handler,
               and loops. Load it in Firefox for Android. Background the app for 5+ minutes.

Decision rule: Audio still playing on foreground → Option A confirmed, proceed.
               Audio dead → investigate whether it died at the blob fetch, the <audio> element,
               or the Media Session registration, then revisit approach.

Timebox:       2 hours
```

### Spike 2 — XenForo DOM selector validation

```
Question:      Do the same CSS selectors reliably identify threadmark content and next/prev
               navigation links across SB, SV, and QQ?

Spike:         Open 5 stories across all three sites, inspect DOM, record the selectors
               for: story content container, next threadmark link, threadmark title,
               story title. Note any site-specific differences.

Decision rule: Same selectors work on all three → one parser. Diverge → site-specific
               parser subclasses or a selector config map per site.

Timebox:       1 hour
```

---

## Open Questions

- [ ] **CSP and blob URLs:** Do SB/SV/QQ's Content Security Policy headers permit `blob:` URLs as `<audio>` sources in content script context? (Check response headers on a threadmark page.)
- [ ] **Resume fidelity:** Saving `charOffset` within a threadmark text means we know *where* in the raw text we stopped, but replaying from mid-chunk means re-fetching and re-speaking from the nearest chunk boundary. Is threadmark-level granularity (resume at the start of the threadmark where you stopped) acceptable, or is within-threadmark resume required for MVP?
- [ ] **AMO vs sideload:** Publish the extension to AMO as an unlisted add-on (simplest path to signed install on Android) or document the custom collection sideload? Unlisted AMO is likely the right call.
- [ ] **Google Translate endpoint longevity:** The `client=tw-ob` variant has been stable for years but is unofficial. If it breaks, the fallback for online TTS is the `client=gtx` variant or the `gTTS` request format. Worth tracking but not a blocker.
