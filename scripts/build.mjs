// Wraps game.html (the page body) into a full site/index.html for GitHub Pages,
// injecting the circle server URL from the WEAVE_SERVER environment variable.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const body = readFileSync(new URL("../game.html", import.meta.url), "utf8");
const server = (process.env.WEAVE_SERVER || "").trim();
if (server && !/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(server)) {
  console.error(`WEAVE_SERVER should look like https://weave-online-server.you.workers.dev (got "${server}")`);
  process.exit(1);
}
const config = `<script>window.WEAVE_SERVER = ${JSON.stringify(server.replace(/\/+$/, ""))};</script>`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="A cosy first-person knitting game by a crackling cabin fire.">
<meta name="theme-color" content="#0f0b09">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${config}
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync(new URL("../site/", import.meta.url), { recursive: true });
writeFileSync(new URL("../site/index.html", import.meta.url), html);
console.log(`Built site/index.html${server ? ` (circle server: ${server})` : " (solo only: WEAVE_SERVER not set)"}`);
