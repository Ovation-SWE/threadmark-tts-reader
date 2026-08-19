/**
 * XenForo threadmark page parser.
 *
 * Targets the XenForo 2.x "reader mode" URL pattern:
 *   /threads/{slug}.{id}/reader/{threadmark-id}/
 *
 * Selector assumptions were validated against SB, SV, and QQ during Spike 2.
 * If a site diverges, add an entry to SITE_SELECTORS with overrides.
 */

export type Site = "sb" | "sv" | "qq";

export interface ThreadmarkPage {
  storyId: string;
  storyTitle: string;
  site: Site;
  currentUrl: string;
  threadmarkTitle: string;
  threadmarkIndex: number;
  nextUrl: string | null;
  prevUrl: string | null;
  bodyText: string;
}

interface SiteSelectors {
  storyTitle: string;
  content: string;
  nextLink: string;
  prevLink: string;
  /** Element whose text content is the threadmark title. */
  threadmarkTitle: string;
  /** Presence of this element signals we're on a threadmark reader page. */
  isThreadmarkPage: string;
}

// XenForo 2.x reader-mode selectors.
// All three sites run XenForo 2.x with the same reader-mode structure; the
// map exists so per-site divergences found during QA can be added without
// touching the core parse logic.
const SITE_SELECTORS: Record<Site, SiteSelectors> = {
  sb: {
    storyTitle: "h1.p-title-value",
    content: "article.message-body .bbWrapper",
    nextLink: "a.threadmarkNav--next",
    prevLink: "a.threadmarkNav--prev",
    threadmarkTitle: ".threadmarkNavigation .threadmarkNav--current",
    isThreadmarkPage: ".threadmarkNavigation",
  },
  sv: {
    storyTitle: "h1.p-title-value",
    content: "article.message-body .bbWrapper",
    nextLink: "a.threadmarkNav--next",
    prevLink: "a.threadmarkNav--prev",
    threadmarkTitle: ".threadmarkNavigation .threadmarkNav--current",
    isThreadmarkPage: ".threadmarkNavigation",
  },
  qq: {
    storyTitle: "h1.p-title-value",
    content: "article.message-body .bbWrapper",
    nextLink: "a.threadmarkNav--next",
    prevLink: "a.threadmarkNav--prev",
    threadmarkTitle: ".threadmarkNavigation .threadmarkNav--current",
    isThreadmarkPage: ".threadmarkNavigation",
  },
};

const SITE_HOSTNAMES: Record<string, Site> = {
  "forums.spacebattles.com": "sb",
  "forums.sufficientvelocity.com": "sv",
  "www.questionablequesting.com": "qq",
};

// /threads/some-title.12345/reader/67/  →  ["12345", "67"]
const READER_URL_RE = /\/threads\/[^/]+\.(\d+)\/reader\/(\d+)\//;

function detectSite(hostname: string): Site | null {
  return SITE_HOSTNAMES[hostname] ?? null;
}

/**
 * Hashes the story's index URL (strip reader path) to a stable string ID.
 * Uses a simple djb2 hash — no crypto needed, just stability.
 */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h >>>= 0; // keep unsigned 32-bit
  }
  return h.toString(36);
}

function storyIndexUrl(url: string): string {
  // Strip everything from /reader/ onward to get the story root URL.
  return url.replace(/\/reader\/.*$/, "/threadmarks");
}

function resolveUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function extractBodyText(el: Element): string {
  // Walk text nodes, skip spoilers/quoteboxes so we only read narrative content.
  const SKIP_SELECTORS = [
    ".bbCodeSpoilerButton",
    ".bbCodeSpoilerText",
    ".attribution", // quote attribution lines
    "blockquote",
    ".quoteContainer",
  ];

  const clone = el.cloneNode(true) as Element;
  for (const sel of SKIP_SELECTORS) {
    clone.querySelectorAll(sel).forEach((n) => n.remove());
  }

  // Collapse whitespace: newlines between block elements → single newline.
  const text = clone.textContent ?? "";
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Returns true when the current document looks like a XenForo threadmark
 * reader page for one of the three supported sites.
 */
export function isThreadmarkPage(doc: Document, url: string): boolean {
  const hostname = new URL(url).hostname;
  const site = detectSite(hostname);
  if (!site) return false;

  const sel = SITE_SELECTORS[site];
  if (!doc.querySelector(sel.isThreadmarkPage)) return false;
  if (!READER_URL_RE.test(url)) return false;
  return true;
}

/**
 * Parse a XenForo threadmark reader page.
 *
 * Throws a descriptive error when a required element is missing so the caller
 * can surface it in the UI rather than silently producing garbage output.
 */
export function parseThreadmarkPage(doc: Document, url: string): ThreadmarkPage {
  const hostname = new URL(url).hostname;
  const site = detectSite(hostname);
  if (!site) throw new Error(`Unsupported site: ${hostname}`);

  const sel = SITE_SELECTORS[site];

  const match = READER_URL_RE.exec(url);
  if (!match) throw new Error(`URL does not match XenForo reader pattern: ${url}`);
  const threadmarkIndex = parseInt(match[2] ?? "0", 10);

  const storyTitleEl = doc.querySelector(sel.storyTitle);
  if (!storyTitleEl) throw new Error(`Story title element not found (selector: ${sel.storyTitle})`);
  const storyTitle = storyTitleEl.textContent?.trim() ?? "";

  const contentEl = doc.querySelector(sel.content);
  if (!contentEl) throw new Error(`Content element not found (selector: ${sel.content})`);
  const bodyText = extractBodyText(contentEl);

  const threadmarkTitleEl = doc.querySelector(sel.threadmarkTitle);
  const threadmarkTitle = threadmarkTitleEl?.textContent?.trim() ?? `Chapter ${threadmarkIndex}`;

  const nextHref = doc.querySelector(sel.nextLink)?.getAttribute("href");
  const prevHref = doc.querySelector(sel.prevLink)?.getAttribute("href");
  const nextUrl = resolveUrl(nextHref, url);
  const prevUrl = resolveUrl(prevHref, url);

  const storyId = hashString(storyIndexUrl(url));

  return {
    storyId,
    storyTitle,
    site,
    currentUrl: url,
    threadmarkTitle,
    threadmarkIndex,
    nextUrl,
    prevUrl,
    bodyText,
  };
}
