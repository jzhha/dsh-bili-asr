#!/usr/bin/env node
// B站视频 → 字幕/台词（互动视频出分支树，普通视频出逐段转写）
//
//   node bin/bili-asr.mjs BV1xxxxxxxxx
//   node bin/bili-asr.mjs https://www.bilibili.com/video/BV1xxxxxxxxx/
//   node bin/bili-asr.mjs BV1xxx --pages 1,2     # 只做指定分P
//
// 产物默认在 <BILI_ASR_HOME>/works/<BV>/：graph.json / tree.md / script.md / transcripts/
// 依赖：<BILI_ASR_HOME>/venv 里的 faster-whisper + <BILI_ASR_HOME>/model（用 node bin/setup.mjs 装）
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, MODEL, PYTHON, WORKS, workDir, log, parseBvid, getJson, sleep } from './lib.mjs';
import { probeSubtitle, fetchSubtitle } from './subtitle.mjs';
import { isInteractive, graphVersion, crawl, renderTree } from './stein.mjs';
import { downloadAudio } from './audio.mjs';
import { buildInteractiveDoc, buildLinearDoc } from './mkdoc.mjs';

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
  console.log(`用法: node bin/bili-asr.mjs <BV号|链接> [--pages 1,2] [--no-asr] [--out 目录]

产物: <out>/<BV>/{graph.json,tree.md,script.md} 与 audio/ transcripts/
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

const dir = workDir(bv, outRoot);
log({ stage: 'start', bv, dir });

// 1) 基本信息
const view = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, bv);
if (view.code !== 0) throw new Error(`取视频信息失败: ${view.code} ${view.message}`);
const title = view.data.title;
const interactive = isInteractive(view);
log({ stage: 'view', title, interactive, duration: view.data.duration, pages: view.data.pages.length });

let cids = [];
let graph = null;

if (interactive) {
  // 2) 互动视频：抓剧情树
  const gv = await graphVersion(bv, view.data.cid);
  if (!gv) throw new Error('互动视频没有取到 graph_version');
  log({ stage: 'graph_version', graphVersion: gv });
  graph = await crawl(bv, gv);
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({ bv, gv, ...graph }, null, 2), 'utf8');
  writeFileSync(join(dir, 'tree.md'), renderTree(bv, graph), 'utf8');
  const uniq = new Map();
  for (const n of graph.nodes) if (n.cid && !uniq.has(n.cid)) uniq.set(n.cid, n.title);
  cids = [...uniq].map(([cid, label]) => ({ cid, label }));
} else {
  // 2') 普通视频：按分P
  const pages = (view.data.pages || []).filter((p) => !onlyPages.length || onlyPages.includes(p.page));
  cids = pages.map((p) => ({ cid: p.cid, label: `P${p.page} ${p.part}` }));
}

log({ stage: 'targets', count: cids.length });

// 3) 平台字幕优先：能拿到字幕的分P/节点直接落 transcripts，不占 CPU
const tdir = join(dir, 'transcripts');
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

// 4) 没字幕的才下音轨 + 本地转写
if (pending.length) await downloadAudio(bv, pending, join(dir, 'audio'));

if (!noAsr && pending.length) {
  if (!existsSync(PYTHON)) throw new Error(`没找到 Python 环境：${PYTHON}\n先跑 node bin/setup.mjs（或插件里的 bili_asr_setup 工具）`);
  if (!existsSync(join(MODEL, 'model.bin'))) throw new Error(`没找到 Whisper 模型：${MODEL}\n先跑 node bin/setup.mjs`);
  await new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [join(BIN, 'transcribe.py'), MODEL, join(dir, 'audio'), tdir], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('transcribe.py exit ' + code))));
    child.on('error', reject);
  });
}

// 5) 文档
const map = new Map();

try {
  for (const name of readdirSync(tdir)) {
    if (!name.endsWith('.json') || name.startsWith('transcripts-summary')) continue;
    const d = JSON.parse(readFileSync(join(tdir, name), 'utf8'));
    map.set(String(d.cid), d);
  }
} catch { /* 尚未转写 */ }

let result;
if (interactive) {
  result = buildInteractiveDoc({ bv, title, graph, transcripts: map, out: join(dir, 'script.md') });
} else {
  const pages = (view.data.pages || []).filter((p) => !onlyPages.length || onlyPages.includes(p.page));
  result = buildLinearDoc({ bv, title, pages, transcripts: map, out: join(dir, 'script.md') });
}
log({ stage: 'done', ...result });
