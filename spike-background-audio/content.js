// Spike: validate that <audio> + Media Session API keeps playing when Firefox
// for Android is backgrounded. Hit the button, background the app, come back.
// If audio is still playing (or resumes instantly on foreground), the approach works.

const SAMPLE_TEXTS = [
  "Sentence one. Testing background audio survival in Firefox for Android.",
  "Sentence two. If you can hear this after backgrounding the app, the spike is passing.",
  "Sentence three. The Media Session API should be keeping this audio alive.",
  "Sentence four. Auto-advancing to the next chunk to simulate threadmark transitions.",
  "Sentence five. Still going. This is what hands-free chapter reading will feel like.",
  "Sentence six. Looping back to the start to keep the test running indefinitely.",
];

let audio = null;
let chunkIndex = 0;
let statusEl = null;
let isRunning = false;

function ttsUrl(text) {
  return (
    "https://translate.google.com/translate_tts" +
    "?ie=UTF-8" +
    "&q=" + encodeURIComponent(text) +
    "&tl=en" +
    "&client=tw-ob" +
    "&ttsspeed=1"
  );
}

async function fetchBlob(text) {
  const resp = await fetch(ttsUrl(text), {
    headers: { "Referer": "https://translate.google.com/" },
  });
  if (!resp.ok) throw new Error("TTS fetch failed: " + resp.status);
  return URL.createObjectURL(await resp.blob());
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log("[TTS Spike]", msg);
}

async function playChunk() {
  if (!isRunning) return;
  const text = SAMPLE_TEXTS[chunkIndex % SAMPLE_TEXTS.length];
  chunkIndex++;
  setStatus("Fetching chunk " + chunkIndex + "…");
  try {
    const prev = audio.src;
    audio.src = await fetchBlob(text);
    if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
    setStatus("Playing chunk " + chunkIndex + " — background the app now");
    await audio.play();
  } catch (err) {
    setStatus("Error: " + err.message + " — retrying in 2s");
    setTimeout(playChunk, 2000);
  }
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) {
    setStatus("Warning: Media Session API not available on this browser/version");
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: "TTS Spike Test",
    artist: "Threadmark Reader",
    album: "Background Audio Validation",
  });
  navigator.mediaSession.setActionHandler("play", () => {
    audio.play();
    setStatus("Resumed via Media Session");
  });
  navigator.mediaSession.setActionHandler("pause", () => {
    audio.pause();
    setStatus("Paused via Media Session");
  });
}

function start() {
  isRunning = true;
  audio = document.createElement("audio");
  audio.setAttribute("playsinline", "");
  document.body.appendChild(audio);

  audio.addEventListener("ended", () => {
    URL.revokeObjectURL(audio.src);
    playChunk();
  });
  audio.addEventListener("error", () => {
    setStatus("Audio element error — retrying in 2s");
    setTimeout(playChunk, 2000);
  });

  setupMediaSession();
  playChunk();
}

function stop() {
  isRunning = false;
  if (audio) {
    audio.pause();
    if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.remove();
    audio = null;
  }
  chunkIndex = 0;
  setStatus("Stopped");
}

// ── UI ────────────────────────────────────────────────────────────────────────

const container = document.createElement("div");
container.style.cssText = [
  "position:fixed", "bottom:16px", "right:16px", "z-index:2147483647",
  "background:#1a1a2e", "color:#eee", "border-radius:10px",
  "padding:12px 14px", "font:14px/1.4 system-ui,sans-serif",
  "box-shadow:0 4px 16px rgba(0,0,0,.5)", "min-width:240px",
  "display:flex", "flex-direction:column", "gap:8px",
].join(";");

statusEl = document.createElement("div");
statusEl.style.cssText = "font-size:12px;color:#aaa;min-height:18px";
statusEl.textContent = "Ready — tap Start to begin";

const btn = document.createElement("button");
btn.textContent = "▶  Start Spike";
btn.style.cssText = [
  "background:#e74c3c", "color:#fff", "border:none", "border-radius:6px",
  "padding:10px 0", "font-size:15px", "cursor:pointer", "font-weight:600",
].join(";");

btn.addEventListener("click", () => {
  if (!isRunning) {
    start();
    btn.textContent = "⏹  Stop";
    btn.style.background = "#555";
  } else {
    stop();
    btn.textContent = "▶  Start Spike";
    btn.style.background = "#e74c3c";
  }
});

container.appendChild(btn);
container.appendChild(statusEl);
document.body.appendChild(container);
