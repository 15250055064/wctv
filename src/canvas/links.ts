// Links worth downloading in a piece of text: a bare link, or the link inside an app's share
// text (抖音 / 小红书 / B站 / 快手 / 微博 copy a sentence with the link in it).

const SHARE_HOSTS = /douyin\.com|xhslink\.com|xiaohongshu\.com|b23\.tv|bilibili\.com|kuaishou\.com|weibo\.com|youtube\.com|youtu\.be/i;

export function shareLink(text: string): string | null {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  const url = /https?:\/\/[^\s，。！]+/i.exec(t)?.[0];
  return url && t.length < 500 && SHARE_HOSTS.test(url) ? url : null;
}

/** A short name for where a link goes, for prompts. */
export function linkSite(url: string) {
  const h = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  if (/douyin/.test(h)) return '抖音';
  if (/xhslink|xiaohongshu/.test(h)) return '小红书';
  if (/b23\.tv|bilibili/.test(h)) return 'B 站';
  if (/kuaishou/.test(h)) return '快手';
  if (/weibo/.test(h)) return '微博';
  if (/youtube|youtu\.be/.test(h)) return 'YouTube';
  return h.replace(/^www\./, '');
}
