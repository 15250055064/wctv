// Builds release/WCcanvastv-darwin-<arch>/WCcanvastv.app. Run: npm run app
import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Only what runs: the built front end, the local server and the Electron main process.
const keep = [/^\/dist(\/|$)/, /^\/server(\/|$)/, /^\/electron(\/|$)/, /^\/package\.json$/];

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
  appVersion: '1.0.0',
  appCategoryType: 'public.app-category.productivity',
  prune: false,
  asar: false,
  ignore: (p) => p !== '' && !keep.some((re) => re.test(p)),
});
console.log(path.join(appPath, 'WCcanvastv.app'));
