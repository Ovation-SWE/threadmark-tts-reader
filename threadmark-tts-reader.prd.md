# Threadmark TTS Reader — PRD

## 1. Problem Statement

Readers of long-form serialized fiction on Spacebattles (SB), Sufficient Velocity (SV), and Questionable Questing (QQ) want to consume stories hands-free — while working out, commuting, doing chores — but existing TTS tools are structurally unaware of how these sites work. Stories are published chapter-by-chapter via a "threadmark" navigation system; each threadmark is a separate page. Generic TTS extensions read only the current page and stop, forcing the listener to manually trigger playback again on every chapter boundary. On Firefox for Android, backgrounding the app kills playback entirely. The result: a use case that should be passive and effortless becomes an active, frustrating chore.

## 2. Evidence

- **Direct usage:** Primary user has used the ReadAloud extension on SB/SV/QQ and observes it stops at every page boundary and loses all state when Firefox is backgrounded on mobile.
- **Platform structure:** SB, SV, and QQ all use the XenForo threadmark system — a navigable linked list of story chapters. This structure is consistent and parseable.
- **Assumption — validate via:** checking whether SB/SV/QQ threadmark DOM structure is stable enough to parse reliably across all three sites.

## 3. Thesis (Why Build It)

Generic TTS extensions treat every page as an isolated document. SB/SV/QQ stories are structured sequences — threadmarks form a linked list with well-defined next/previous navigation. A purpose-built extension that understands this structure can auto-advance, queue chapters ahead of time, and maintain a persistent playback cursor that survives tab switching, app backgrounding, and session restarts. No existing tool does this. The closest alternative — ReadAloud — requires manual intervention at every chapter and loses all state on mobile. This extension makes the experience passive end-to-end.

## 4. Hypothesis

**We believe** that a threadmark-aware TTS extension with persistent playback state will cause frequent SB/SV/QQ readers to complete long-form serialized fiction hands-free — without manually intervening at chapter boundaries or re-finding their place after interruptions.

**We'll know we're RIGHT if:** a story can be started, the phone backgrounded, and playback continues (or resumes at the exact threadmark on reopen) without any screen interaction.

**We'll know we're WRONG if:** the user still has to manually trigger or re-locate more than once per listening session, OR if TTS drops unexpectedly or requires CAPTCHA resolution during normal use.

## 5. Target User & JTBD

**Primary user:** Frequent reader of serialized web fiction on SB/SV/QQ who listens while doing something physical or parallel (working out, commuting, chores). Technically comfortable enough to install a Firefox extension; not a developer.

**JTBD:** *When I want to follow a long story during a workout or chore, I want to hit play once and have the story read itself through — surviving phone screen-off, app switching, and chapter breaks — so I can stay in the story without touching my phone.*

**Non-users (explicitly out of scope for MVP):**
- Readers who want to read text visually — this tool is audio-first
- Users on platforms other than SB, SV, QQ
- Screenreader / accessibility users with different technical needs (different tool, different requirements)

## 6. MVP

The thinnest version that proves the hypothesis end-to-end:

1. **Threadmark auto-advance** — when TTS reaches the end of a threadmark's content, automatically navigate to the next threadmark and continue reading without user input.
2. **Resume on reopen** — when the extension is re-opened (tab reload, app foregrounded, Firefox restarted), resume from the exact threadmark and approximate position where playback stopped.
3. **TTS engine:** Google Translate TTS as the default voice (no CAPTCHA friction, free, no account required). Must not require the user to solve a CAPTCHA or authenticate during normal use.
4. **Stable playback:** TTS must not drop silently mid-story; if a network hiccup interrupts it, it should retry or notify, not silently fail.
5. **Minimal UI:** A simple play/pause/stop control visible on story pages. No elaborate UI in the MVP.

**Not in the MVP:** offline TTS, Chrome support, reading inter-threadmark content, history, favorites, crosspost clustering, voice selection.

## 7. Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Zero manual re-triggers per session | User does not touch the phone between start and end of a listening session | Self-reported by primary user over first week |
| Playback survival on mobile background | App can be backgrounded for 10+ minutes and resume correctly | Manual test on Firefox for Android |
| No CAPTCHA friction | TTS never prompts for CAPTCHA during a normal listening session | Observed during use; zero incidents = pass |
| Silent drop rate | TTS does not silently stop more than once per hour of playback | Self-reported over first week |

## 8. Non-Goals

- **Chrome support** — defer; Firefox first.
- **Offline / local TTS engine** — defer to post-MVP. (High-quality offline engine is a desired future feature.)
- **Inter-threadmark content** (forum posts, author notes between chapters) — optional future toggle, not MVP.
- **Reading history & favorites** — useful, ship after core playback is stable.
- **Crosspost clustering** — stories crossposted across SB/SV/QQ should eventually be grouped in a crosspost folder (since content can differ); not MVP.
- **Social or sharing features** — out of scope entirely.
- **Merging crossposted story content** — content differs per site; do not merge, only cluster.

## 9. Open Questions

- [ ] **Mobile background audio (highest risk):** Firefox for Android may suspend or kill tab audio when backgrounded. Can a WebExtension keep audio alive via the Media Session API or a background service worker? Needs a spike before committing to the mobile-first promise.
- [ ] **Google Translate TTS rate limiting:** The endpoint used by ReadAloud is unofficial and has been known to rate-limit or block at volume. Is there a safe request cadence, or does this risk CAPTCHA at longer story lengths? Validate before shipping.
- [ ] **Threadmark DOM stability:** SB, SV, and QQ all run XenForo but may be on different versions with different DOM structures. Need to audit all three sites' threadmark navigation markup before assuming a single parser works.
- [ ] **Playback position persistence:** "Resume at exact position" within a threadmark likely means storing a character/word offset. What's the fidelity needed — threadmark granularity (coarse) or within-threadmark position (fine)?
- [ ] **Firefox for Android extension support:** Not all WebExtension APIs are available on GeckoView (Firefox Android). Verify which APIs are needed and which are available before designing the architecture.
- [ ] **TTS voice quality:** Google Translate TTS quality may be acceptable; user has not confirmed this. If not, what's the fallback before offline TTS is built?

---

*Next step: run **`/skills:plan-architecture`** to make the engineering decisions this PRD deliberately left open — browser extension architecture, background audio strategy, TTS integration approach, and persistence layer.*
