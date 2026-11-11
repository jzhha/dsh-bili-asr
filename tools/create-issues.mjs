#!/usr/bin/env node
// 把 docs/BACKLOG.md 里的条目批量建成 GitHub issue，并加入 Project 看板。
//
//   node tools/create-issues.mjs --repo jzhha/dsh-bili-asr --project 1 --owner jzhha
//   node tools/create-issues.mjs ... --dry-run      # 只打印将要创建的条目
//
// 需要已登录的 gh（gh auth status 通过）。已存在的同名 issue 会跳过，可重复执行。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes('--' + name);

const backLogPath = arg('backlog', 'docs/BACKLOG.md');
const repo = arg('repo', '');
const owner = arg('owner', repo.split('/')[0] || '');
const project = arg('project', '1');
const dryRun = flag('dry-run');

const ghBin = process.env.GH_BIN || 'gh';
const run = (args, input) =>
  execFileSync(ghBin, args, { encoding: 'utf8', input, maxBuffer: 8 * 1024 * 1024 }).trim();

// ---- 解析 BACKLOG.md ----
const lines = readFileSync(backLogPath, 'utf8').split(/\r?\n/);
const items = [];
let priority = '';
let cur = null;
for (const line of lines) {
  const p = line.match(/^##\s+(P[0-2])/);
  if (p) { priority = p[1]; cur = null; continue; }
  const h = line.match(/^###\s+\d+\.\s+(.+)$/);
  if (h) {
    cur = { title: h[1].trim(), priority, body: [] };
    items.push(cur);
    continue;
  }
  if (cur) cur.body.push(line);
}
for (const it of items) {
  it.body = it.body.join('\n').trim();
}

if (!items.length) {
  console.error('BACKLOG.md 里没有解析到条目（期望 "### 1. 标题" 这种格式）');
  process.exit(1);
}
console.log(`解析到 ${items.length} 条：` + items.map((i) => `${i.priority}:${i.title}`).join(' | '));
if (dryRun) process.exit(0);
if (!repo || !owner) {
  console.error('需要 --repo <owner/name>，例如 --repo jzhha/dsh-bili-asr');
  process.exit(1);
}

// ---- 确保标签存在 ----
const ensureLabel = (name, color) => {
  try {
    run(['label', 'create', name, '--repo', repo, '--color', color, '--force']);
    console.log(`label ok: ${name}`);
  } catch (e) {
    console.warn(`label skip: ${name} (${String(e.message).slice(0, 80)})`);
  }
};
ensureLabel('backlog', 'ededed');
ensureLabel('P0', 'b60205');
ensureLabel('P1', 'fbca04');
ensureLabel('P2', '0e8a16');

// ---- 已存在的 issue 标题（避免重复）----
let existing = [];
try {
  existing = JSON.parse(run(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'title']));
} catch (e) {
  console.warn('读取已有 issue 失败（可能仓库还没内容）：' + String(e.message).slice(0, 120));
}
const existingTitles = new Set(existing.map((x) => x.title));

const tmp = mkdtempSync(join(tmpdir(), 'bili-backlog-'));
let created = 0;
let skipped = 0;
for (const it of items) {
  if (existingTitles.has(it.title)) {
    console.log(`skip (exists): ${it.title}`);
    skipped++;
    continue;
  }
  const bodyFile = join(tmp, it.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60) + '.md');
  writeFileSync(bodyFile, it.body + '\n', 'utf8');
  let url = '';
  try {
    url = run(['issue', 'create', '--repo', repo, '--title', it.title, '--body-file', bodyFile,
      '--label', 'backlog', '--label', it.priority]);
  } catch (e) {
    console.error(`issue FAIL: ${it.title} :: ${String(e.message).slice(0, 200)}`);
    continue;
  }
  console.log(`issue created: ${url}`);
  created++;
  if (url && project) {
    try {
      run(['project', 'item-add', String(project), '--owner', owner, '--url', url]);
      console.log(`  -> added to project ${project}`);
    } catch (e) {
      console.warn(`  -> project add failed: ${String(e.message).slice(0, 160)}`);
    }
  }
}
console.log(`\n完成：新建 ${created} 条，跳过 ${skipped} 条，共 ${items.length} 条`);
