// Extracts selected entries from a zip on a web server without downloading the whole archive:
// reads the central directory with HTTP range requests, then fetches only the wanted entries.
// Used for RIFE, whose macOS release zip carries every model version (436 MB) when one
// model (~20 MB) is needed.
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

async function range(url, start, end) {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(10 * 60_000) });
  if (r.status !== 206) throw new Error(`服务器不支持分段下载（${r.status}）`);
  return Buffer.from(await r.arrayBuffer());
}

async function size(url) {
  const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const n = Number(r.headers.get('content-length'));
  if (!r.ok || !n) throw new Error(`读取不到文件大小（${r.status}）`);
  return { size: n, url: r.url };
}

/** Central directory entries: name, compression method, sizes and local header offset. */
async function listEntries(url, total) {
  const tail = await range(url, Math.max(0, total - 65_557), total - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  // Zip64: sizes live in the zip64 end-of-central-directory record.
  if (cdOffset === 0xffffffff) {
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const z64 = await range(url, Number(tail.readBigUInt64LE(loc + 8)), Number(tail.readBigUInt64LE(loc + 8)) + 55);
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const out = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, method, csize, offset, mode: cd.readUInt32LE(p + 38) >>> 16 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Writes the entries whose names `want(name)` accepts into `dest`, keeping their paths
 * relative to `strip` (a leading folder to drop). Returns the bytes downloaded.
 */
export async function extractRemote(srcUrl, dest, want, strip = '') {
  const { size: total, url } = await size(srcUrl);
  const entries = (await listEntries(url, total)).filter((e) => !e.name.endsWith('/') && want(e.name));
  if (!entries.length) throw new Error('压缩包里没有需要的文件');
  let bytes = 0;
  for (const e of entries) {
    const head = await range(url, e.offset, e.offset + 29);
    const dataStart = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = e.csize ? await range(url, dataStart, dataStart + e.csize - 1) : Buffer.alloc(0);
    bytes += raw.length;
    const data = e.method === 8 ? zlib.inflateRawSync(raw) : e.method === 0 ? raw : null;
    if (!data) throw new Error(`不支持的压缩方式：${e.method}`);
    const rel = strip && e.name.startsWith(strip) ? e.name.slice(strip.length) : e.name;
    const file = path.join(dest, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, data, { mode: e.mode & 0o111 ? 0o755 : 0o644 });
  }
  return bytes;
}
