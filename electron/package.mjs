// Builds release/WCcanvastv-darwin-<arch>/WCcanvastv.app. Run: npm run app
import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ship FFmpeg (video tools) inside the app as bin/ffmpeg, with its license files.
const ffmpegDir = path.join(root, 'node_modules', 'ffmpeg-static');
fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
for (const [from, to] of [['ffmpeg', 'ffmpeg'], ['ffmpeg.LICENSE', 'ffmpeg.LICENSE'], ['ffmpeg.README', 'ffmpeg.README']]) {
  fs.copyFileSync(path.join(ffmpegDir, from), path.join(root, 'bin', to));
}
fs.chmodSync(path.join(root, 'bin', 'ffmpeg'), 0o755);
// Only what runs: the built front end, the local server and the Electron main process.
const keep = [/^\/dist(\/|$)/, /^\/server(\/|$)/, /^\/electron(\/|$)/, /^\/bin(\/|$)/, /^\/package\.json$/];

const [appPath] = await packager({
  dir: root,
  out: path.join(root, 'release'),
  name: 'WCcanvastv',
  executableName: 'WCcanvastv',
  platform: 'darwin',
  arch: process.arch,
  overwrite: true,
  icon: path.join(root, 'build', 'icon.icns'),
  appBundleId: 'local.wccanvastv.app',
  appVersion: '1.1.0',
  appCategoryType: 'public.app-category.productivity',
  prune: false,
  asar: false,
  ignore: (p) => p !== '' && !keep.some((re) => re.test(p)),
});
console.log(path.join(appPath, 'WCcanvastv.app'));
