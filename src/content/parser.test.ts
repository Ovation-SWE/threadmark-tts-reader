import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { isThreadmarkPage, parseThreadmarkPage } from "./parser";

const _dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): Document {
  const html = readFileSync(resolve(_dirname, "../__fixtures__", name), "utf-8");
  return new DOMParser().parseFromString(html, "text/html");
}

// ── Site detection ────────────────────────────────────────────────────────────

describe("isThreadmarkPage", () => {
  it("detects SB reader page", () => {
    const doc = loadFixture("sb-threadmark.html");
    const url = "https://forums.spacebattles.com/threads/the-metropolitan-man.12345/reader/2/";
    expect(isThreadmarkPage(doc, url)).toBe(true);
  });

  it("detects SV reader page", () => {
    const doc = loadFixture("sv-threadmark.html");
    const url = "https://forums.sufficientvelocity.com/threads/a-song-of-ice-and-algorithms.67890/reader/3/";
    expect(isThreadmarkPage(doc, url)).toBe(true);
  });

  it("detects QQ reader page", () => {
    const doc = loadFixture("qq-threadmark.html");
    const url = "https://www.questionablequesting.com/threads/dungeon-crawler-carl-fan.99999/reader/1/";
    expect(isThreadmarkPage(doc, url)).toBe(true);
  });

  it("rejects unsupported site", () => {
    const doc = loadFixture("sb-threadmark.html");
    const url = "https://www.fanfiction.net/s/12345/1/story";
    expect(isThreadmarkPage(doc, url)).toBe(false);
  });

  it("rejects non-reader URL on supported site", () => {
    const doc = loadFixture("sb-threadmark.html");
    const url = "https://forums.spacebattles.com/threads/the-metropolitan-man.12345/";
    expect(isThreadmarkPage(doc, url)).toBe(false);
  });

  it("rejects regular thread page (no threadmarkNavigation)", () => {
    const doc = loadFixture("non-threadmark.html");
    const url = "https://forums.spacebattles.com/threads/general.99/reader/1/";
    expect(isThreadmarkPage(doc, url)).toBe(false);
  });

  it("returns false (does not throw) on a malformed URL", () => {
    const doc = loadFixture("sb-threadmark.html");
    expect(isThreadmarkPage(doc, "not-a-url")).toBe(false);
  });
});

// ── Content extraction — SB ───────────────────────────────────────────────────

describe("parseThreadmarkPage (SB)", () => {
  const url = "https://forums.spacebattles.com/threads/the-metropolitan-man.12345/reader/2/";

  it("parses without throwing", () => {
    const doc = loadFixture("sb-threadmark.html");
    expect(parseThreadmarkPage(doc, url)).toBeDefined();
  });

  it("sets currentUrl to the passed-in URL", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.currentUrl).toBe(url);
  });

  it("extracts story title", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.storyTitle).toBe("The Metropolitan Man");
  });

  it("detects site as sb", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.site).toBe("sb");
  });

  it("extracts threadmark title", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.threadmarkTitle).toBe("Chapter 1: The Coming of the Superman");
  });

  it("extracts threadmark index from URL", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.threadmarkIndex).toBe(2);
  });

  it("extracts next URL", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.nextUrl).toBe(
      "https://forums.spacebattles.com/threads/the-metropolitan-man.12345/reader/3/"
    );
  });

  it("extracts prev URL", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.prevUrl).toBe(
      "https://forums.spacebattles.com/threads/the-metropolitan-man.12345/reader/1/"
    );
  });

  it("extracts body text without spoiler content", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.bodyText).not.toContain("Hidden content here that should not be read aloud");
  });

  it("excludes quoted block from body text", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.bodyText).not.toContain("Clark Kent wrote:");
    expect(r.bodyText).not.toContain("No comment at this time");
  });

  it("includes narrative text in body", () => {
    const doc = loadFixture("sb-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.bodyText).toContain("Lois Lane had seen a lot of strange things");
    expect(r.bodyText).toContain("The Planet's editor wanted three thousand words");
  });

  it("produces a stable storyId for the same thread", () => {
    const doc = loadFixture("sb-threadmark.html");
    const url2 = "https://forums.spacebattles.com/threads/the-metropolitan-man.12345/reader/5/";
    const r1 = parseThreadmarkPage(doc, url);
    const r2 = parseThreadmarkPage(doc, url2);
    expect(r1.storyId).toBe(r2.storyId);
  });

  it("produces different storyIds for different threads", () => {
    const doc = loadFixture("sb-threadmark.html");
    const urlA = "https://forums.spacebattles.com/threads/story-a.11111/reader/1/";
    const urlB = "https://forums.spacebattles.com/threads/story-b.22222/reader/1/";
    const rA = parseThreadmarkPage(doc, urlA);
    const rB = parseThreadmarkPage(doc, urlB);
    expect(rA.storyId).not.toBe(rB.storyId);
  });
});

// ── Content extraction — SV ───────────────────────────────────────────────────

describe("parseThreadmarkPage (SV)", () => {
  const url = "https://forums.sufficientvelocity.com/threads/a-song-of-ice-and-algorithms.67890/reader/3/";

  it("detects site as sv", () => {
    const doc = loadFixture("sv-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.site).toBe("sv");
  });

  it("extracts story title", () => {
    const doc = loadFixture("sv-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.storyTitle).toBe("A Song of Ice and Algorithms");
  });

  it("extracts threadmark index 3", () => {
    const doc = loadFixture("sv-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.threadmarkIndex).toBe(3);
  });

  it("extracts narrative text", () => {
    const doc = loadFixture("sv-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.bodyText).toContain("three-eyed raven");
  });
});

// ── Content extraction — QQ (last threadmark: null nextUrl) ──────────────────

describe("parseThreadmarkPage (QQ, last chapter)", () => {
  const url = "https://www.questionablequesting.com/threads/dungeon-crawler-carl-fan.99999/reader/1/";

  it("detects site as qq", () => {
    const doc = loadFixture("qq-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.site).toBe("qq");
  });

  it("returns null for nextUrl on last threadmark", () => {
    const doc = loadFixture("qq-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.nextUrl).toBeNull();
  });

  it("returns a prevUrl for non-first threadmarks", () => {
    const doc = loadFixture("qq-threadmark.html");
    const r = parseThreadmarkPage(doc, url);
    expect(r.prevUrl).toBe(
      "https://www.questionablequesting.com/threads/dungeon-crawler-carl-fan.99999/reader/0/"
    );
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("parseThreadmarkPage errors", () => {
  it("throws on unsupported site", () => {
    const doc = loadFixture("sb-threadmark.html");
    expect(() =>
      parseThreadmarkPage(doc, "https://www.fanfiction.net/s/12345/1/story")
    ).toThrow("Unsupported site");
  });

  it("throws when URL does not match reader pattern", () => {
    const doc = loadFixture("sb-threadmark.html");
    expect(() =>
      parseThreadmarkPage(doc, "https://forums.spacebattles.com/threads/story.12345/")
    ).toThrow("XenForo reader pattern");
  });

  it("throws when story title element is missing", () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <nav class="threadmarkNavigation">
          <span class="threadmarkNav--current">Ch 1</span>
        </nav>
        <article class="message-body"><div class="bbWrapper">text</div></article>
      </body></html>`,
      "text/html"
    );
    expect(() =>
      parseThreadmarkPage(doc, "https://forums.spacebattles.com/threads/x.1/reader/1/")
    ).toThrow("Story title element not found");
  });

  it("throws when content element is missing", () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <h1 class="p-title-value">Title</h1>
        <nav class="threadmarkNavigation">
          <span class="threadmarkNav--current">Ch 1</span>
        </nav>
      </body></html>`,
      "text/html"
    );
    expect(() =>
      parseThreadmarkPage(doc, "https://forums.spacebattles.com/threads/x.1/reader/1/")
    ).toThrow("Content element not found");
  });
});

// ── Body text whitespace normalization ────────────────────────────────────────

describe("extractBodyText whitespace normalization", () => {
  it("collapses runs of 3+ newlines to a double newline", () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <h1 class="p-title-value">Title</h1>
        <nav class="threadmarkNavigation">
          <span class="threadmarkNav--current">Ch 1</span>
        </nav>
        <article class="message-body">
          <div class="bbWrapper">First paragraph.



Fourth paragraph after triple blank line.</div>
        </article>
      </body></html>`,
      "text/html"
    );
    const r = parseThreadmarkPage(
      doc,
      "https://forums.spacebattles.com/threads/x.1/reader/1/"
    );
    expect(r.bodyText).not.toMatch(/\n{3,}/);
    expect(r.bodyText).toContain("First paragraph.");
    expect(r.bodyText).toContain("Fourth paragraph after triple blank line.");
  });
});
