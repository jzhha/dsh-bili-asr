// 合并：转写结果 + 剧情树 → 可读剧本
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HALLUCINATION = /^字幕|字幕由|字幕by|字幕制作|请点赞|订阅|关注我/i;
const clean = (s) => {
  const t = (s || '').trim();
  return HALLUCINATION.test(t) ? '' : t;
};

function loadTranscripts(dir) {
  const map = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    let text = (d.text || '').trim();
    if (HALLUCINATION.test(text)) text = '';
    map.set(String(d.cid), { text, duration: d.duration });
  }
  return map;
}

export function buildInteractiveDoc({ bv, title, graph, transcripts, out }) {
  const byId = new Map(graph.nodes.map((n) => [n.edgeId, n]));
  const kids = new Map();
  for (const e of graph.edges) {
    if (!kids.has(e.from)) kids.set(e.from, []);
    kids.get(e.from).push(e);
  }
  const say = (n) => (n?.cid ? clean(transcripts.get(String(n.cid))?.text) : '');
  const nodeLabel = (n) => (/^\d+$/.test(String(n?.title ?? '')) ? '节点 ' + n.title : (n?.title || '（未命名）'));
  const withText = graph.nodes.filter((n) => say(n));
  const silent = graph.nodes.filter((n) => n.cid && !say(n));
  const leaves = graph.nodes.filter((n) => n.isLeaf);
  const chars = [...transcripts.values()].reduce((s, t) => s + clean(t.text).length, 0);

  let md = `# ${bv} ${title} · 分支 + 台词（本地 ASR）\n\n`;
  md += `- 结构：${graph.nodes.length} 节点 / ${graph.edges.length} 选择边 / ${leaves.length} 结局\n`;
  md += `- 台词：${withText.length}/${graph.nodes.length} 个节点转出文字；${silent.length} 个节点无台词（环境音/静音）\n`;
  md += `- 总字数 ${chars}；来源 stein 剧情图 + 节点音轨（faster-whisper small, CPU int8）\n`;
  md += `- ⚠️ ASR 有误字，引用原句请按语境理解\n\n---\n\n`;

  const seen = new Set();
  const walk = (id, indent) => {
    const n = byId.get(id);
    if (!n) return;
    const pad = '  '.repeat(indent);
    if (seen.has(id)) { md += `${pad}- ↺ 回到「${n.title}」\n`; return; }
    seen.add(id);
    md += `${pad}- **${nodeLabel(n)}**${n.isLeaf ? ' 【结局】' : ''}　${say(n) ? `「${say(n)}」` : '（无台词）'}\n`;
    for (const e of kids.get(id) || []) {
      md += `${pad}  - 「${e.option}」→\n`;
      walk(e.to, indent + 2);
    }
  };
  walk(0, 0);

  md += `\n---\n\n## 结局台词\n\n`;
  for (const n of leaves) md += `- **${nodeLabel(n)}**${say(n) ? '：' + say(n) : ''}\n`;

  md += `\n## 台词原文（按节点，去重）\n\n`;
  const printed = new Set();
  for (const n of withText) {
    const key = String(n.cid);
    if (printed.has(key)) continue;
    printed.add(key);
    md += `### ${n.title}\n\n${transcripts.get(key).text}\n\n`;
  }
  writeFileSync(out, md, 'utf8');
  return { out, nodes: graph.nodes.length, withText: withText.length, silent: silent.length, chars };
}

export function buildLinearDoc({ bv, title, pages, transcripts, out }) {
  let md = `# ${bv} ${title} · 逐段台词（本地 ASR）\n\n`;
  md += `- 分 P ${pages.length}；来源音轨（faster-whisper small, CPU int8）\n- ⚠️ ASR 有误字\n\n---\n\n`;
  let chars = 0;
  let got = 0;
  for (const p of pages) {
    const t = transcripts.get(String(p.cid));
    const text = clean(t?.text);
    if (text) { got++; chars += text.length; }
    md += `## P${p.page} ${p.part}（${p.duration}s）\n\n${text || '（无语音/无台词）'}\n\n`;
  }
  writeFileSync(out, md, 'utf8');
  return { out, pages: pages.length, withText: got, chars };
}
