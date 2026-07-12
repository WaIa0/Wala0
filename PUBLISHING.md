# Publishing Office Run

The game is fully static (`index.html`, `game.js`, `style.css`, `sw.js`,
`site.webmanifest`, `assets/`) and works from any URL. All music and sound
effects are synthesized in code at runtime — there are no licensed audio
assets, so the whole project can be sold or published commercially.
(Verify the art assets' license if they came from an AI image tool.)

Live site: https://wala0-run-for-your-life.netlify.app

## 1. itch.io (free, ~30 minutes, do this first)

1. Create an account at https://itch.io, then Dashboard → "Create new project".
2. Kind of project: **HTML** ("played in the browser").
3. Upload a zip of the project root (the zip must contain `index.html` at
   its top level — same layout as this repo).
4. Check "This file will be played in the browser".
5. Embed options: 960 × 540, enable "Mobile friendly" + fullscreen button.
6. Pricing: "$0 or donate" to start, or set a minimum price.
7. Add screenshots, a short description, and publish.

## 2. Web portals with revenue (CrazyGames / Poki)

Both review submissions and pay a share of ad revenue if accepted.

- CrazyGames: https://developer.crazygames.com — create a developer
  account, submit the game URL or upload the build. They will ask you to
  integrate their SDK (ads between runs); it's a small JS snippet.
- Poki: https://developers.poki.com — same idea, invite-based review.

Tip: portals like games with their SDK hooks at "game over" and "restart" —
both events already exist in `game.js` (`gameOver()` / `startRun()`).

## 3. Google Play (Trusted Web Activity, $25 one-time)

The game is already a PWA (manifest + service worker + icons), which is
exactly what this path needs.

1. Register at https://play.google.com/console ($25 one-time fee).
2. Go to https://www.pwabuilder.com, enter the live site URL, and let it
   package an Android app (creates a signed `.aab` you upload to the Play
   Console).
3. In the Play Console: create the app, upload the `.aab`, fill in the
   store listing (use `assets/icon-512.png`, screenshots of gameplay),
   complete the content-rating questionnaire (it's a casual game, no
   violence), and add a privacy policy URL. The game stores nothing and
   has no analytics, so a one-paragraph "this game collects no data"
   policy hosted on the Netlify site is enough.
4. Submit for review (usually a few days for a new developer account).

Note: PWABuilder will ask you to upload `assetlinks.json` to the site to
prove ownership — it generates the file; put it at
`.well-known/assetlinks.json` in this repo and redeploy.

## 4. Apple App Store ($99/year, needs a Mac)

Apple rejects thin website wrappers, so wrap with Capacitor and bundle all
files offline:

    npm create @capacitor/app office-run-ios
    # copy index.html, game.js, style.css, assets/ into the web dir
    npx cap add ios && npx cap open ios   # requires Xcode on a Mac

Add small native touches to pass review (haptics on collision, Game Center
leaderboard for best distance). Submit via App Store Connect.

## Selling the game itself

- Sell source-code licenses on https://codecanyon.net (buyers reskin it).
- License non-exclusive builds directly to smaller game portals.
- A full sale of the property (site + store listings) can go through
  https://flippa.com once it has traffic or revenue history.
