import { build } from "esbuild";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
const js = await build({ entryPoints: ["src/main.jsx"], bundle: true, minify: true, write: false, jsx: "automatic", format: "iife",
  define: { "process.env.NODE_ENV": '"production"' }, loader: { ".js": "jsx" } });
execSync("npx tailwindcss -i src/styles.css -o dist/app.css --minify", { stdio: "inherit" });
const css = readFileSync("dist/app.css", "utf8");
const code = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SafeGrid Analytics</title>
<meta name="description" content="Road accident management and family support dashboard, Nagari pilot, Chittoor district">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+Tamil:wght@400;600&family=Noto+Sans+Telugu:wght@400;600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${code}</script>
</body>
</html>`;
writeFileSync("dist/index.html", html);
console.log("built", (html.length / 1024).toFixed(0), "KB");
