# Design snapshot - 2026-09-06, before the mint / peach / graphite rebrand

This folder freezes how the app and the marketing site LOOKED on 2026-09-06,
right before the full visual rebrand (new logo, new palette, new slogan).
Content and behaviour were not part of that change - only the skin.

## How to go back to this design

The code is frozen in git at the live commit `af8edfc`:

- tag:    `design-v1-before-mint-2026-09-06`
- branch: `design-v1-snapshot-2026-09-06`

Full rollback of production to this design:

    git checkout design-v1-snapshot-2026-09-06
    git push origin HEAD:master --force-with-lease   # Vercel deploys master

Partial rollback (only the visual files) from any later commit:

    git checkout design-v1-before-mint-2026-09-06 -- src/app/globals.css src/app/v2.css src/components/logo.tsx public/

## Screenshots in this folder

- `desktop-*.png` / `mobile-*.png` - marketing pages on friendlyinvoice.co.il (1440 / 390 wide)
- `app-*.png` - signed-in app screens (Lynkeus QA user) at 1440 / 390 wide

Palette at the time: accent orange-to-rose gradient (#f97316 -> #e11d48), cream
surfaces, ink charts, colourful sidebar icons, Heebo everywhere.
