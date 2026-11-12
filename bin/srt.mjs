// 把 transcripts/*.json 转成 SRT / VTT 字幕文件
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const pad = (n, w = 2) => String(n).padStart(w, '0');

const stamp = (sec, comma = true) => {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const xs = s % 60;
  const whole = Math.floor(xs);
  const ms = Math.round((xs - whole) * 1000);
  const msStr = pad(ms, 3);
  return `${pad(h)}:${pad(m)}:${pad(whole)}${comma ? ',' : '.'}${msStr}`;
};

/** segments → SRT 文本，offset 用于多分P拼接时的时间偏移 */
export function toSrt(segments, offset = 0) {
  const lines = [];
  let i = 1;
  for (const seg of segments) {
    const start = Number(seg.start) || 0;
    const end = Number(seg.end) || start + 0.6;
    const text = String(seg.text || '').trim();
    if (!text) continue;
    lines.push(String(i++), `${stamp(start + offset)} --> ${stamp(Math.max(end, start + 0.2) + offset)}`, text, '');
  }
  return lines.join('\n');
}

export function toVtt(segments, offset = 0) {
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    const start = Number(seg.start) || 0;
    const end = Number(seg.end) || start + 0.6;
    const text = String(seg.text || '').trim();
    if (!text) continue;
    lines.push(`${stamp(start + offset, false)} --> ${stamp(Math.max(end, start + 0.2) + offset, false)}`, text, '');
  }
  return lines.join('\n');
}

/** 读 transcripts 目录成 Map<cid, transcript> */
export function loadTranscripts(tdir) {
  const map = new Map();
  if (!existsSync(tdir)) return map;
  for (const name of readdirSync(tdir)) {
    if (!name.endsWith('.json') || name.startsWith('transcripts-summary')) continue;
    try {
      const d = JSON.parse(readFileSync(join(tdir, name), 'utf8'));
      map.set(String(d.cid), d);
    } catch { /* 跳过坏文件 */ }
  }
  return map;
}

/**
 * 写字幕到 <dir>/subtitles/：
 *   - 每个 cid 一个 <cid>.srt / .vtt
 *   - 非互动视频额外合一个 <BV>.srt / .vtt（按分P顺序累加时间偏移）
 */
export function writeSubtitles({ dir, bv, pages, transcripts, interactive }) {
  const outDir = join(dir, 'subtitles');
  mkdirSync(outDir, { recursive: true });
  let single = 0;
  for (const [cid, t] of transcripts) {
    if (!t.segments || !t.segments.length) continue;
    writeFileSync(join(outDir, cid + '.srt'), toSrt(t.segments), 'utf8');
    writeFileSync(join(outDir, cid + '.vtt'), toVtt(t.segments), 'utf8');
    single++;
  }
  let merged = null;
  if (!interactive && Array.isArray(pages) && pages.length > 1) {
    const srt = [];
    const vtt = ['WEBVTT', ''];
    let offset = 0;
    for (const p of pages) {
      const t = transcripts.get(String(p.cid));
      const dur = Number(p.duration) || 0;
      if (t && t.segments && t.segments.length) {
        srt.push(toSrt(t.segments, offset).trimEnd());
        vtt.push(toVtt(t.segments, offset).replace(/^WEBVTT\s*\n?/, '').trimEnd());
      }
      offset += dur || (t && t.segments.length ? Number(t.segments[t.segments.length - 1].end) || 0 : 0);
    }
    if (srt.length) {
      writeFileSync(join(outDir, bv + '.srt'), srt.join('\n\n') + '\n', 'utf8');
      writeFileSync(join(outDir, bv + '.vtt'), vtt.join('\n\n') + '\n', 'utf8');
      merged = join(outDir, bv + '.srt');
    }
  }
  return { files: single, merged };
}
