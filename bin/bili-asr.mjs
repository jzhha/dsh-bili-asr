#!/usr/bin/env node
// B站视频 → 字幕/台词（互动视频出分支树，普通视频出逐段转写）
//
//   node bin/bili-asr.mjs BV1xxxxxxxxx
//   node bin/bili-asr.mjs BV1xxx --pages 1,2          # 指定分P
//   node bin/bili-asr.mjs BV1xxx --srt                # 额外导出 SRT/VTT
//   node bin/bili-asr.mjs BV1xxx --rebuild            # 只用已有产物重建 script.md（不联网）
//
// 产物默认在 <BILI_ASR_HOME>/works/<BV>/：
//   script.md / tree.md / graph.json / meta.json / transcripts/ / audio/ / frames/ / subtitles/
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, MODEL, PYTHON, WORKS, workDir, log, parseBvid, getJson, sleep, die, apiHint } from './lib.mjs';
import { probeSubtitle, fetchSubtitle } from './subtitle.mjs';
import { grabFrames } from './frame.mjs';
import { isInteractive, graphVersion, crawl, renderTree } from './stein.mjs';
import { downloadAudio } from './audio.mjs';
import { buildInteractiveDoc, buildLinearDoc } from './mkdoc.mjs';
import { loadTranscripts, writeSubtitles } from './srt.mjs';

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
  console.log(`用法: node bin/bili-asr.mjs <BV号|链接> [--pages 1,2] [--no-asr] [--frames [--at 秒]] [--srt] [--out 目录]
       node bin/bili-asr.mjs <BV号|链接> --rebuild [--srt]     # 用已有 transcripts 重建文档

产物: <out>/<BV>/{script.md,tree.md,graph.json,meta.json,transcripts,audio,frames,subtitles}
--out 省略时写到 ${WORKS}\\<BV>\\`);
  process.exit(argv.length ? 0 : 1);
}
const bv = parseBvid(argv[0]);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const onlyPages = argOf('--pages', '').split(',').filter(Boolean).map(Number);
const noAsr = argv.includes('--no-asr');
const outRoot = argOf('--out', '');
const wantFrames = argv.includes('--frames');
const frameAt = Number(argOf('--at', '1')) || 1;
const wantSrt = argv.includes('--srt');
const rebuild = argv.includes('--rebuild');

const dir = workDir(bv, outRoot);
log({ stage: 'start', bv, dir, rebuild });

const tdir = join(dir, 'transcripts');
const metaPath = join(dir, 'meta.json');

/** 扫描 frames/ 得到 cid → 路径 */
function loadFrames() {
  const map = new Map();
  const fdir = join(dir, 'frames');
  if (!existsSync(fdir)) return map;
  for (const name of readdirSync(fdir)) {
    if (!name.endsWith('.jpg')) continue;
    map.set(name.replace(/\.jpg$/, ''), join(fdir, name));
  }
  return map;
}

function buildDocs({ title, interactive, graph, pages, transcripts, frames }) {
  if (interactive) {
    return buildInteractiveDoc({ bv, title, graph, transcripts, frames, out: join(dir, 'script.md') });
  }
  return buildLinearDoc({ bv, title, pages, transcripts, frames, out: join(dir, 'script.md') });
}

/* ---------- 只重建文档 ---------- */
if (rebuild) {
  if (!existsSync(metaPath)) {
    die('NO_META', '这个目录里没有 meta.json，没法只重建文档', '先完整跑一次（音轨/转写有缓存，很快），之后就能用 --rebuild。');
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const transcripts = loadTranscripts(tdir);
  const frames = loadFrames();
  let graph = null;
  if (meta.interactive) {
    const gpath = join(dir, 'graph.json');
    if (!existsSync(gpath)) die('NO_GRAPH', '互动视频缺少 graph.json', '重新跑一次完整任务（剧情树会重新抓）。');
    graph = JSON.parse(readFileSync(gpath, 'utf8'));
  }
  mkdirSync(tdir, { recursive: true });
  const result = buildDocs({ title: meta.title, interactive: meta.interactive, graph, pages: meta.pages || [], transcripts, frames });
  let srt = null;
  if (wantSrt) srt = writeSubtitles({ dir, bv, pages: meta.pages || [], transcripts, interactive: meta.interactive });
  log({ stage: 'done', rebuild: true, ...result, srt });
  process.exit(0);
}

/* ---------- 完整流程 ---------- */
const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, bv);
if (view.code !== 0) {
  const h = apiHint(view.code, view.message);
  die(h.code, `取视频信息失败：${view.code} ${view.message || ''}`.trim(), h.hint);
}
const title = view.data.title;
const interactive = isInteractive(view);
const allPages = (view.data.pages || []).map((p) => ({ page: p.page, cid: p.cid, part: p.part, duration: p.duration }));
const pages = allPages.filter((p) => !onlyPages.length || onlyPages.includes(p.page));
log({ stage: 'view', title, interactive, duration: view.data.duration, pages: pages.length });

let cids = [];
let graph = null;
let gv = null;

if (interactive) {
  gv = await graphVersion(bv, view.data.cid);
  if (!gv) die('GRAPH_UNAVAILABLE', '这是互动视频，但没取到 graph_version', '可能视频刚改过或接口变了；先用 --no-asr 看结构，再开 issue 附上 BV 号。');
  log({ stage: 'graph_version', graphVersion: gv });
  graph = await crawl(bv, gv);
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({ bv, gv, ...graph }, null, 2), 'utf8');
  writeFileSync(join(dir, 'tree.md'), renderTree(bv, graph), 'utf8');
  const uniq = new Map();
  for (const n of graph.nodes) if (n.cid && !uniq.has(n.cid)) uniq.set(n.cid, n.title);
  cids = [...uniq].map(([cid, label]) => ({ cid, label }));
} else {
  cids = pages.map((p) => ({ cid: p.cid, label: `P${p.page} ${p.part}` }));
}

if (!cids.length) die('NO_PARTS', '没有可处理的分P/节点', '确认视频不是纯互动入口或已下架；可加 --pages 指定。');
log({ stage: 'targets', count: cids.length });

// 记下重建文档需要的信息（--rebuild 靠它，不联网）
writeFileSync(metaPath, JSON.stringify({
  bv, title, interactive, gv,
  pages: interactive ? [] : pages,
  savedAt: new Date().toISOString(),
}, null, 1), 'utf8');

// 节点截图
let frames = new Map();
if (wantFrames) {
  if (!existsSync(PYTHON)) die('SETUP_REQUIRED', `没找到 Python 环境：${PYTHON}`, '抓截图要用 venv 里的 PyAV + Pillow：先跑 bili_asr_setup。');
  const shot = await grabFrames(bv, cids, join(dir, 'frames'), { at: frameAt });
  frames = shot.map;
  log({ stage: 'frames-summary', ok: shot.ok, total: shot.total });
} else {
  frames = loadFrames();
}

// 平台字幕优先
mkdirSync(tdir, { recursive: true });
let pending = cids;
if (!noAsr) {
  const remaining = [];
  let fromSubtitle = 0;
  for (const item of cids) {
    const track = await probeSubtitle(bv, item.cid);
    if (track) {
      const parsed = await fetchSubtitle(bv, track);
      if (parsed) {
        const duration = parsed.segments.length ? parsed.segments[parsed.segments.length - 1].end : 0;
        writeFileSync(join(tdir, String(item.cid) + '.json'), JSON.stringify({
          cid: item.cid, duration, segments: parsed.segments, text: parsed.text,
          source: 'subtitle', lan: track.lan,
        }, null, 1), 'utf8');
        fromSubtitle++;
        log({ stage: 'subtitle', cid: item.cid, state: 'ok', lan: track.lan, chars: parsed.text.length });
        await sleep(150);
        continue;
      }
    }
    remaining.push(item);
  }
  log({ stage: 'subtitle-summary', fromSubtitle, remaining: remaining.length });
  pending = remaining;
}

// 没字幕的才下音轨 + 本地转写
if (pending.length) {
  let report = [];
  try {
    report = await downloadAudio(bv, pending, join(dir, 'audio'));
  } catch (e) {
    die(e.code || 'AUDIO_FAILED', e.message || String(e), e.hint || '音轨下载失败；换条视频或稍后重试。');
  }
  const okCount = report.filter((r) => r.state === 'ok' || r.state === 'cached').length;
  if (report.length && okCount === 0) {
    die('AUDIO_FAILED', '所有分P的音轨都没拿到', '可能是会员/地区限制或 CDN 拒绝；带 --no-asr 只抓结构，或换网络再试。');
  }
}

if (!noAsr && pending.length) {
  if (!existsSync(PYTHON)) die('SETUP_REQUIRED', `没找到 Python 环境：${PYTHON}`, '先跑 bili_asr_setup（或 node bin/setup.mjs）装环境。');
  if (!existsSync(join(MODEL, 'model.bin'))) die('SETUP_REQUIRED', `没找到 Whisper 模型：${MODEL}`, '模型没下全：重新跑一次 bili_asr_setup，它会校验 sha256 并续传。');
  await new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [join(BIN, 'transcribe.py'), MODEL, join(dir, 'audio'), tdir], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error('transcribe.py 退出码 ' + code), { code: 'TRANSCRIBE_FAILED' }))));
    child.on('error', reject);
  });
}

// 文档
const map = loadTranscripts(tdir);
const result = buildDocs({ title, interactive, graph, pages, transcripts: map, frames });
let srt = null;
if (wantSrt) srt = writeSubtitles({ dir, bv, pages: interactive ? [] : pages, transcripts: map, interactive });
log({ stage: 'done', ...result, srt });
