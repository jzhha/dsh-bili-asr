// 互动视频（stein 剧情图）抓取与渲染
import { getJson, sleep, log } from './lib.mjs';

export function isInteractive(view) {
  return view?.data?.rights?.is_stein_gate === 1;
}

/** 从 player/v2 取 graph_version（入口 cid） */
export async function graphVersion(bv, cid) {
  const j = await getJson(`https://api.bilibili.com/x/player/v2?bvid=${bv}&cid=${cid}`, bv);
  return j?.data?.interaction?.graph_version || null;
}

async function edgeInfo(bv, gv, edgeId) {
  const j = await getJson(`https://api.bilibili.com/x/stein/edgeinfo_v2?bvid=${bv}&edge_id=${edgeId}&graph_version=${gv}`, bv);
  if (j.code !== 0) return { error: `${j.code} ${j.message || ''}` };
  const d = j.data;
  const choices = [];
  for (const q of d.edges?.questions || []) {
    for (const c of q.choices || []) choices.push({ choiceId: c.id, option: c.option, cid: c.cid });
  }
  return { title: d.title, isLeaf: !!d.is_leaf, nodeId: d.story_list?.[0]?.node_id,
           cid: d.story_list?.[0]?.cid, choices };
}

/** BFS 抓整棵剧情树。注意：edge_id 要传 choice.id 才能取到下一节点（传顺序 1/2/3 多为 -400） */
export async function crawl(bv, gv, { maxNodes = 300 } = {}) {
  const nodes = new Map();
  const edges = [];
  const queue = [{ edgeId: 0, depth: 0, cid: null }];
  const seen = new Set([0]);
  let requests = 0;
  let stopped = null;

  while (queue.length) {
    const cur = queue.shift();
    if (nodes.size >= maxNodes) { stopped = `node-cap-${maxNodes}`; break; }
    const info = await edgeInfo(bv, gv, cur.edgeId);
    requests++;
    await sleep(280);
    if (info.error) {
      nodes.set(cur.edgeId, { edgeId: cur.edgeId, depth: cur.depth, error: info.error, cid: cur.cid });
      if (String(info.error).includes('412')) { stopped = 'http-412'; break; }
      continue;
    }
    nodes.set(cur.edgeId, {
      edgeId: cur.edgeId, depth: cur.depth, cid: cur.cid ?? info.cid ?? null,
      title: info.title, isLeaf: info.isLeaf, choices: info.choices.length,
    });
    for (const c of info.choices) {
      edges.push({ from: cur.edgeId, option: c.option, to: c.choiceId });
      if (!seen.has(c.choiceId)) {
        seen.add(c.choiceId);
        queue.push({ edgeId: c.choiceId, depth: cur.depth + 1, cid: c.cid });
      }
    }
  }
  const all = [...nodes.values()];
  log({ stage: 'graph', nodes: all.length, edges: edges.length, leaves: all.filter((n) => n.isLeaf).length, stopped, requests });
  return { nodes: all, edges, stopped, requests };
}

/** 纯结构树 */
export function renderTree(bv, graph) {
  const byId = new Map(graph.nodes.map((n) => [n.edgeId, n]));
  const kids = new Map();
  for (const e of graph.edges) {
    if (!kids.has(e.from)) kids.set(e.from, []);
    kids.get(e.from).push(e);
  }
  let md = `# ${bv} 互动剧情树\n\n- 节点 ${graph.nodes.length} · 选择边 ${graph.edges.length} · 结局 ${graph.nodes.filter((n) => n.isLeaf).length}\n\n`;
  const seen = new Set();
  const walk = (id, indent) => {
    const n = byId.get(id);
    if (!n) return;
    const pad = '  '.repeat(indent);
    if (seen.has(id)) { md += `${pad}- ↺ 回到「${n.title}」\n`; return; }
    seen.add(id);
    md += `${pad}- **${n.title}**${n.isLeaf ? ' 【结局】' : ''}\n`;
    for (const e of kids.get(id) || []) {
      md += `${pad}  - 「${e.option}」→\n`;
      walk(e.to, indent + 2);
    }
  };
  walk(0, 0);
  return md;
}
