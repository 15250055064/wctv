// Renders the app icon to build/icon-1024.png with Electron's offscreen renderer.
// Run: npx electron electron/make-icon.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon-1024.png');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2d4a"/>
      <stop offset="1" stop-color="#0f1016"/>
    </linearGradient>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8ea6ff"/>
      <stop offset="1" stop-color="#6d5cff"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb36b"/>
      <stop offset="1" stop-color="#ff6b8a"/>
    </linearGradient>
    <pattern id="dots" width="48" height="48" patternUnits="userSpaceOnUse">
      <circle cx="24" cy="24" r="3" fill="#ffffff" opacity=".10"/>
    </pattern>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#bg)"/>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#dots)"/>
  <rect x="101" y="101" width="822" height="822" rx="189" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
  <path d="M372 392 C 500 392, 500 632, 628 632" fill="none" stroke="#c9d2ff" stroke-width="22" stroke-linecap="round" opacity=".85"/>
  <rect x="210" y="282" width="220" height="220" rx="44" fill="url(#a)"/>
  <rect x="246" y="330" width="120" height="18" rx="9" fill="#fff" opacity=".9"/>
  <rect x="246" y="372" width="148" height="18" rx="9" fill="#fff" opacity=".6"/>
  <rect x="246" y="414" width="96" height="18" rx="9" fill="#fff" opacity=".6"/>
  <rect x="594" y="522" width="220" height="220" rx="44" fill="url(#b)"/>
  <circle cx="660" cy="590" r="24" fill="#fff" opacity=".9"/>
  <path d="M614 708 L 690 620 L 742 676 L 770 648 L 794 708 Z" fill="#fff" opacity=".85"/>
  <circle cx="430" cy="392" r="20" fill="#fff"/>
  <circle cx="594" cy="632" r="20" fill="#fff"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: 1024, height: 1024 }).toPNG());
  console.log(`icon written: ${out}`);
  app.quit();
});
