// 节点截图：Range 只取开头一小段视频（fMP4 首个分片就有 IDR），交给 PyAV 解一帧
import { writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { getJson, sleep, log, PYTHON, BIN } from './lib.mjs';

const HEAD = (bv) => ({ 'user-agent': 'Mozilla/5.0', referer: `https://www.bilibili.com/video/${bv}/` });

/** 取一个 cid 的一帧，写到 <outDir>/<cid>.jpg。返回 { ok, bytes?, error? } */
export async function grabFrame(bv, cid, outJpg, at = 1.0) {
  const j = await getJson(`https://api.bilibili.com/x/player/playurl?bvid=${bv}&cid=${cid}&fnval=16&fourk=1`, bv);
  if (j.code !== 0 || !j.data?.dash?.video?.length) return { ok: false, error: 'no-video-track' };
  const track = [...j.data.dash.video].sort((a, b) => a.bandwidth - b.bandwidth)[0];

  const tmpFile = join(tmpdir(), 'bili-asr-' + randomBytes(3).toString('hex') + '.m4s');
  try {
    const res = await fetch(track.baseUrl, {
      headers: { ...HEAD(bv), range: 'bytes=0-1200000' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return { ok: false, error: 'http-' + res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20000) return { ok: false, error: 'too-small-' + buf.length };
    writeFileSync(tmpFile, buf);

    mkdirSync(join(outJpg, '..'), { recursive: true });
    const r = spawnSync(PYTHON, [join(BIN, 'frames.py'), tmpFile, outJpg, String(at)], { encoding: 'utf8', timeout: 90000 });
    if (r.status !== 0) return { ok: false, error: (r.stdout || r.stderr || 'frame-failed').trim().slice(0, 120) };
    return { ok: true, bytes: existsSync(outJpg) ? statSync(outJpg).size : 0, info: (r.stdout || '').trim() };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 120) };
  } finally {
    try { rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
  }
}

/** 批量抓帧：cids = [{cid,label}]，产物 <framesDir>/<cid>.jpg */
export async function grabFrames(bv, cids, framesDir, opts = {}) {
  mkdirSync(framesDir, { recursive: true });
  const map = new Map();
  let ok = 0;
  for (const item of cids) {
    const out = join(framesDir, item.cid + '.jpg');
    const r = await grabFrame(bv, item.cid, out, opts.at ?? 1.0);
    map.set(String(item.cid), r.ok ? out : null);
    if (r.ok) ok++;
    log({ stage: 'frame', cid: item.cid, state: r.ok ? 'ok' : 'failed', bytes: r.bytes || 0, info: r.info || undefined, error: r.error });
    await sleep(200);
  }
  return { map, ok, total: cids.length };
}
