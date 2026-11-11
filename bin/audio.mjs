// 节点/分P 音轨下载（最低码率，带头重试与备用码率）
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, sleep, log, headers } from './lib.mjs';

async function download(url, bv) {
  const res = await fetch(url, { headers: headers(bv), signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error('http ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error('payload too small ' + buf.length);
  return buf;
}

/** cids: [{ cid, label }] */
export async function downloadAudio(bv, cids, audioDir) {
  const report = [];
  for (const { cid, label } of cids) {
    const file = join(audioDir, String(cid) + '.m4s');
    if (existsSync(file) && statSync(file).size > 2000) {
      report.push({ cid, label, state: 'cached' });
      continue;
    }
    const j = await getJson(`https://api.bilibili.com/x/player/playurl?bvid=${bv}&cid=${cid}&fnval=16&fourk=1`, bv);
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
          writeFileSync(file, buf);
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
  log({ stage: 'audio', total: cids.length, ok: report.filter((r) => r.state === 'ok' || r.state === 'cached').length,
        failed: report.filter((r) => !['ok', 'cached'].includes(r.state)) });
  return report;
}
