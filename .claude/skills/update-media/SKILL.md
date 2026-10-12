---
name: update-media
description: >
  Re-records docs/media (UI screenshots, demo.mp4 for certshell.dev, demo.gif
  for the README) and updates the site/README copy that describes them. Use
  after a visible UI feature lands, or when the user says "update the
  screenshots", "re-record the demo", "update the brand site", "update-media"
  or "/update-media".
---

Media comes from `apps/web/media/record.ts` (`bun run media`): the dev UI
with every `/api` call and the terminal socket faked by
`apps/web/media/fixtures.ts`. No backend, no real hosts.

## 1. Tools

`ffmpeg` and Playwright's Chromium. If missing:
`apt-get install -y ffmpeg` and `cd apps/web && bunx playwright install --with-deps chromium`.

## 2. Show the new feature

- **Data**: add it to `fixtures.ts`, typed with `@repo/shared` types so
  typecheck catches API drift. If the UI calls a new endpoint, mock it in
  `mockApi`, or the page shows an error.
- **Screenshots**: add a `shot()` in `screenshots()`. Name the file after
  the page/state (`admin-host-tags.png`).
- **Demo**: add a short beat to `walkthrough()`. Use `click()` (it moves
  the fake cursor so the viewer sees what was clicked) and `pause()`. Keep
  the whole demo ~30s; trim other pauses before adding length. Navigate by
  clicking, not `page.goto`: a goto flashes white in the video.

## 3. Record and look

Run `bun run media`, then look at the output before committing:

- Screenshots: Read the PNGs.
- Demo: make a contact sheet and Read it, e.g.
  `ffmpeg -i docs/media/demo.mp4 -vf "fps=1,scale=640:-1,tile=5x7" -frames:v 1 <scratchpad>/tiles.png`.
  Check the last frames too (`-sseof -1`).

Watch for: wrong suggestion picked (Enter picks the first option, which
may be "Create …"), tooltips or focus rings left open, error toasts,
skeletons caught mid-load, a white first frame.

## 4. Copy

Update what describes the media and features, only where it changed:

- `site/index.html`: the demo `<video>` `aria-label`, the Features cards.
- `README.md`: the demo GIF alt text, "How it works".

## 5. Ship

`bun run lint && bun run typecheck && bun run test`. Separate commits:
script/fixtures, `docs/media`, site/README copy. Branch + PR, never push to
`main`. Merging to `main` deploys the site (`.github/workflows/site.yml`).
