---
name: tech-stack
description: Languages, build tools, test framework, and constraints for forum-reader
metadata:
  type: project
---

- **Language**: TypeScript strict mode (`noUncheckedIndexedAccess: true`)
- **Build**: Vite 8 + `vite-plugin-web-extension`; `npm run build` → `dist/`
- **Manifest**: MV2 (Firefox Android GeckoView requires MV2; MV3 deferred until Chrome support)
- **UI framework**: None — popup is ~50 lines of vanilla DOM
- **No runtime npm dependencies** — keeps the extension small and auditable
- **Testing**: Vitest 4 + jsdom; tests use explicit `import { describe, it, expect } from "vitest"` even though `globals: true`
- **Types**: `@types/firefox-webext-browser` in main tsconfig; `node` + `vitest/globals` only in `tsconfig.test.json`
- **TTS**: Google Translate unofficial endpoint (`client=tw-ob`), chunked at ≤190 chars, returns MP3 blobs

**How to apply:** No new runtime dependencies without explicit sign-off. New test files must follow the import pattern from `parser.test.ts`.
