// 分P/节点音轨下载：全局缓存（<HOME>/cache/audio/<cid>.m4s）+ works/audio 用硬链接，避免重复下载与磁盘翻倍
import { writeFileSync, existsSync, statSync, mkdirSync, linkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, sleep, log, headers, HOME } from './lib.mjs';

const CACHE_DIR = join(HOME, 'cache', 'audio');

async function download(url, bv) {
  const res = await fetch(url, { headers: headers(bv), signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error('http ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error('payload too small ' + buf.length);
  return buf;
}

const usable = (p) => existsSync(p) && statSync(p).size > 2000;

/** 把缓存文件挂到目标路径：优先硬链接（同盘零拷贝），失败就复制 */
function attach(src, dest) {
  try {
    if (existsSync(dest)) return;
    linkSync(src, dest);
  } catch {
    try { copyFileSync(src, dest); } catch { /* 交给调用方判断 */ }
  }
}

/** cids: [{ cid, label }] */
export async function downloadAudio(bv, cids, audioDir) {
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  const report = [];

  for (const { cid, label } of cids) {
    const file = join(audioDir, String(cid) + '.m4s');
    const cacheFile = join(CACHE_DIR, String(cid) + '.m4s');

    if (usable(file)) { report.push({ cid, label, state: 'cached' }); continue; }
    if (usable(cacheFile)) {
      attach(cacheFile, file);
      if (usable(file)) { report.push({ cid, label, state: 'cache-hit' }); continue; }
    }

    const j = await getJson(`https://api.bilibili.com/x/player/playurl?bvid=${bv}&cid=${cid}&fnval=16&fourk=1`, bv);
    if (j.code === -412) {
      const e = new Error('RATE_LIMITED');
      e.code = 'RATE_LIMITED';
      e.hint = '拿音轨时被风控（412），等几分钟再试，或带 BILI_SESSDATA。';
      throw e;
    }
    if (j.code !== 0 || !j.data?.dash?.audio?.length) {
      report.push({ cid, label, state: 'no-audio', message: j.message });
      await sleep(300);
      continue;
    }

    const tracks = [...j.data.dash.audio].sort((a, b) => a.bandwidth - b.bandwidth);
    let saved = null;
    for (const t of tracks) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const buf = await download(t.baseUrl, bv);
          writeFileSync(cacheFile, buf);      // 先进全局缓存
          attach(cacheFile, file);            // 再挂到本次产物目录
          if (!usable(file)) writeFileSync(file, buf);
          saved = { bytes: buf.length, bandwidth: t.bandwidth };
          break;
        } catch (e) {
          saved = { error: e.message };
          if (attempt < 3) await sleep(1000 * attempt);
        }
      }
      if (saved && !saved.error) break;
    }
    report.push({ cid, label, state: saved && !saved.error ? 'ok' : 'failed', ...(saved || {}) });
    await sleep(300);
  }

  const ok = report.filter((r) => ['ok', 'cached', 'cache-hit'].includes(r.state)).length;
  const hits = report.filter((r) => r.state === 'cache-hit').length;
  log({ stage: 'audio', total: cids.length, ok, hits, failed: report.filter((r) => !['ok', 'cached', 'cache-hit'].includes(r.state)) });
  return report;
}
