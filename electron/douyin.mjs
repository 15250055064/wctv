// 抖音 links for 链接下载. Douyin signs its data requests in the page's own code, so command-line
// downloaders keep breaking. Instead the video page is opened in a hidden, muted window
// (its own browser storage, no account) and the player's video files are read from it: the
// highest-bitrate stream the player loads, or the pictures of a photo post. Runs in the
// app's main process; the local server calls it through globalThis.__wctvDouyin.
import { BrowserWindow, session } from 'electron';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/** The video or note id in a Douyin link, following short share links (v.douyin.com/…). */
async function itemOf(url) {
  let u = url;
  for (let i = 0; i < 5; i++) {
    const m = /\/(video|note|slides)\/(\d{8,})/.exec(u) ?? /[?&](?:modal_id|aweme_id)=(\d{8,})/.exec(u);
    if (m) return m.length === 3 ? { type: m[1] === 'video' ? 'video' : 'note', id: m[2] } : { type: 'video', id: m[1] };
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA } }).catch(() => null);
    const next = r?.headers.get('location');
    if (!next) break;
    u = new URL(next, u).toString();
  }
  throw new Error('没有从这个链接里找到抖音视频');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves a Douyin link to downloadable files: { title, files: [{ url, kind }], headers }.
 * `onLog` gets progress messages.
 */
export async function resolveDouyin(url, onLog = () => {}) {
  const item = await itemOf(url);
  onLog('正在打开抖音页面…');
  const ses = session.fromPartition('douyin-download');
  ses.setUserAgent(UA);
  // Video streams the player fetches; the URL's br= is its bitrate.
  const streams = new Map();
  const listener = (d) => {
    const ct = (d.responseHeaders?.['content-type'] ?? d.responseHeaders?.['Content-Type'] ?? [''])[0];
    if (/^video\//.test(ct) && /douyinvod|\/video\/tos\//.test(d.url)) {
      const br = Number(/[?&]br=(\d+)/.exec(d.url)?.[1] ?? 0);
      const key = d.url.split('?')[0];
      if (!streams.has(key) || streams.get(key).br < br) streams.set(key, { url: d.url, br });
    }
  };
  ses.webRequest.onResponseStarted(listener);
  const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { session: ses, backgroundThrottling: false } });
  w.webContents.setAudioMuted(true);
  try {
    w.loadURL(`https://www.douyin.com/${item.type === 'video' ? 'video' : 'note'}/${item.id}`).catch(() => {});
    let page = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      page = await w.webContents
        .executeJavaScript(
          `(() => {
            const v = document.querySelector('video');
            const sources = v ? [...v.querySelectorAll('source')].map((s) => s.src).concat(v.currentSrc || v.src || '').filter((s) => /^https?:/.test(s)) : [];
            // Photo posts: the large pictures in the post (not avatars or icons).
            const images = [...document.querySelectorAll('img')].filter((i) => i.naturalWidth >= 600 && /douyinpic|tos-cn-i/.test(i.src)).map((i) => i.src);
            return { title: document.title.replace(/ - 抖音$/, ''), sources, images: [...new Set(images)] };
          })()`,
        )
        .catch(() => null);
      if (page?.sources.length) break;
      if (item.type === 'note' && page?.images.length) break;
    }
    if (!page) throw new Error('抖音页面打不开，请检查网络');
    if (page.sources.length) {
      // Let the player settle on its quality, then take the best stream it loaded.
      onLog('正在找最高清的版本…');
      await sleep(4000);
      const best = [...streams.values()].sort((a, b) => b.br - a.br)[0];
      return { title: page.title, files: [{ url: best?.url ?? page.sources[0], kind: 'video' }], headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' } };
    }
    if (page.images.length) return { title: page.title, files: page.images.slice(0, 35).map((u) => ({ url: u, kind: 'image' })), headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' } };
    throw new Error('这个抖音作品读不到（可能已删除、设为私密，或需要登录才能看）');
  } finally {
    ses.webRequest.onResponseStarted(null);
    w.destroy();
  }
}
