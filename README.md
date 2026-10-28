# Weave Online

A cosy first-person knitting game in three.js. Sit by a crackling cabin fire and knit a scarf by swiping the path of the needle tip: insert, wrap, pull through, slip off.

Keep a rhythm for combos (×5 in full flow), keep the fire fed, and knit the orders that come in: a scarf for the cat, a tea cosy, mittens for the postie. Everything you finish appears in the cabin. Expect company: a moth, an owl, a yarn-thieving cat, dropped stitches, and a bear that comes through the window.

Play alone, or join a **knitting circle**: up to five players share the cabin, sit in armchairs around the fire, watch each other's needles move live, and every finished row is added to one shared circle blanket that stays in the room.

## Project layout

| Path | What it is |
| --- | --- |
| `game.html` | The whole game (markup, styles, script). Edit this. |
| `scripts/build.mjs` | Wraps `game.html` into `site/index.html` and injects the circle server URL. |
| `server/` | The knitting circle room server: a PartyServer class on Cloudflare Durable Objects. |
| `.github/workflows/pages.yml` | Builds and deploys the game to GitHub Pages on every push to `main`. |

## 1. Put the game on GitHub Pages

1. Push this repo to GitHub.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow by hand). The game appears at `https://<you>.github.io/<repo>/`.

Without a server URL the game runs solo, and the "Join the circle" button stays disabled.

## 2. Deploy the circle server (free Cloudflare account)

```sh
cd server
npm install
npx wrangler login      # opens a browser to sign in to Cloudflare
npx wrangler deploy
```

Wrangler prints a URL like `https://weave-online-server.<your-subdomain>.workers.dev`. Opening it in a browser should say the server is running.

This uses SQLite-backed Durable Objects, which are included in the Workers Free plan (daily limits apply; see Cloudflare's Durable Objects pricing page).

## 3. Connect the game to the server

In the GitHub repo: **Settings → Secrets and variables → Actions → Variables → New repository variable**

- Name: `WEAVE_SERVER`
- Value: the URL from step 2, e.g. `https://weave-online-server.your-subdomain.workers.dev`

Re-run the Pages workflow. "Join the circle" is now live. Each circle is named in the URL (`.../#cosy-ab12`), so sharing the link invites someone into the same cabin.

## Running locally

```sh
# terminal 1: room server on http://localhost:8787
cd server && npm install && npx wrangler dev

# terminal 2: build the page against the local server, then serve it
WEAVE_SERVER=http://localhost:8787 node scripts/build.mjs   # see note below
npx serve site
```

Note: `build.mjs` only accepts `https://` URLs as a safety check. For local testing, temporarily set `window.WEAVE_SERVER = "http://localhost:8787"` in the generated `site/index.html`.

## How the circle works

- **One Durable Object per circle.** The circle name in the URL is the room name; every player in that circle connects to the same instance over a WebSocket at `/parties/cabin/<circle>`.
- **Server-authoritative stitches.** Clients send each committed stitch; the server validates it, tracks each player's current row, and when 12 stitches complete a row it stores the row in SQLite and broadcasts it to everyone. Late joiners get the last 120 blanket rows.
- **Cosmetic needle progress.** While someone swipes, their client sends gesture progress (0–100) about 10 times a second. Everyone else animates that player's needles locally from it. Nothing is predicted or corrected.
- **Hibernation-safe.** Player state lives on each connection and the blanket in storage, so the room can sleep between messages and wake without losing anything.
- **Limits.** Five players per circle, names cleaned to 16 characters, stitches rate-limited, emotes from a fixed set.
