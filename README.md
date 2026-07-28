# OpenReview Live Preview

OpenReview Live Preview is a local-first, side-by-side editor for writing
OpenReview submissions, reviews, and rebuttals without switching between
Write and Preview tabs.

It includes:

- OpenReview-compatible Markdown, sanitization, MathJax, and typography
- Real-time preview with click, cursor, and scroll synchronization
- Bidirectional navigation between source and rendered blocks
- Lightweight source find/replace and preview search highlighting
- Markdown linting and OpenReview-specific authoring warnings
- Chinese and English interfaces
- Automatic browser-local draft persistence

Draft text stays in the browser's `localStorage`. The app has no backend and
does not send drafts to OpenReview or another application service. MathJax is
loaded from the same jsDelivr URL used by OpenReview.

This is an independent, unofficial tool. It is not affiliated with, authorized
by, or endorsed by OpenReview.

[Source code](https://github.com/sharpshark73/openreview-live-preview) ·
[License](./LICENSE.md) ·
[Third-party notices](./THIRD_PARTY_NOTICES.md)

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Commands

```bash
npm run dev      # Start the local development server
npm run build    # Create a production build
npm run build:static # Export a static site to dist/client
npm run start    # Serve the production build
npm run lint     # Run static checks
npm test         # Build and run compatibility tests
```

## Production

```bash
npm run build
npm run start
```

## Static hosting

For Cloudflare Pages, use:

- Build command: `npm run build:static`
- Build output directory: `dist/client`
- Node.js version: `22.13.0`

Pushes to `main` are also deployed automatically to
[GitHub Pages](https://sharpshark73.github.io/openreview-live-preview/) by the
included Pages workflow. Its separate `npm run build:pages` command applies the
repository subpath required by GitHub Pages.

## Docker

```bash
docker build -t openreview-live-preview .
docker run --rm -p 3000:3000 openreview-live-preview
```

## Project structure

```text
app/       User interface and styling
lib/       OpenReview renderer, source mapping, warnings, and lint support
scripts/   Reproducible browser-bundle generation
tests/     Renderer and production-output compatibility tests
worker/    Cloudflare/Vinext production entry point
```

## Compatibility baseline and license

The renderer currently tracks OpenReview web v1.15.25, commit
`553a5a65fe7ba269aeaa5c56c06a6b84356d03f4` from 2026-07-21. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for source and license
details.

The complete project is distributed under
[GNU AGPL v3 or later](./LICENSE.md). Anyone deploying a modified version over
a network must keep the in-app source link available. Forks and alternate
deployments should set `NEXT_PUBLIC_SOURCE_URL` to a public repository
containing the exact corresponding source for their deployed version.
