// dsh-bili-asr —— 把 B站视频转成本地文字（宿主半端）
//
//  · 工具：bili_asr_setup / bili_asr_run / bili_asr_status / bili_asr_doc
//  · HTTP：/api/bili-asr/{jobs,job,doc,run,setup}  ← 客户端半端（client.js）用
//  · 数据根目录 dataDir：venv/ model/ works/ 都在它下面（默认 $DSH_HOME/bili-asr）
//
// 不裸 import @deepseek-ai/*：桌面版 profile 是 autoInstallPeers:false，
// 拿不到 defineTool 就退回本地等价实现（与 dsh-bili-scroll 同一套策略）。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

export const name = 'bili-asr';
export const inject = ['tools', 'webServer'];

const PKG = dirname(fileURLToPath(import.meta.url));
const CLI = join(PKG, 'bin', 'bili-asr.mjs');
const SETUP = join(PKG, 'bin', 'setup.mjs');
const jobs = new Map();

let defineTool = null;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
} catch {
  defineTool = (options) => options; // 宿主 JSON Schema 校验由本地链路自己保证
}

const bvOf = (s) => {
  const m = String(s || '').match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : null;
};

function pathsOf(config) {
  const dataDir = config?.dataDir
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'bili-asr');
  const outDir = config?.outDir || join(dataDir, 'works');
  return { dataDir, outDir };
}

function childEnv(config, dataDir) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', BILI_ASR_HOME: dataDir };
  if (config?.pythonPath) env.BILI_ASR_PYTHON = config.pythonPath;
  if (config?.asrModelPath) env.BILI_ASR_MODEL = config.asrModelPath;
  if (config?.pipIndex) env.BILI_ASR_PIP_INDEX = config.pipIndex;
  if (config?.hfEndpoint) env.BILI_ASR_HF = config.hfEndpoint;
  return env;
}

function loadPersisted(outDir) {
  try {
    const file = join(outDir, 'jobs.json');
    if (!existsSync(file)) return;
    for (const j of JSON.parse(readFileSync(file, 'utf8'))) {
      if (!j?.id || jobs.has(j.id)) continue;
      // 客户端重启过：上次还在跑的任务，进程已经不在了，别让它永远显示“转写中”
      if (j.state === 'running') { j.state = 'interrupted'; j.note = '进程已随客户端退出，可重新发起'; j.endedAt = j.endedAt || Date.now(); }
      jobs.set(j.id, { ...j, log: j.log || [] });
    }
  } catch { /* 坏文件不影响启动 */ }
}

function persist(outDir) {
  try {
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, 'jobs.json');
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify([...jobs.values()].slice(-50), null, 1), 'utf8');
    renameSync(tmp, file);
  } catch { /* 落盘失败不影响工具 */ }
}

const queue = [];
let running = null;

/** 起一个子进程任务（kind: transcribe | setup）。串行执行：ASR 抢 CPU，并发只会越来越慢。 */
function startProc(config, kind, scriptPath, args, extra = {}) {
  const { dataDir, outDir } = pathsOf(config);
  if (!existsSync(scriptPath)) throw new Error('找不到脚本: ' + scriptPath);
  const id = randomBytes(4).toString('hex');
  const job = {
    id, kind, bv: extra.bv || '', title: extra.title || '', state: 'queued',
    startedAt: Date.now(), queuedAt: Date.now(), doc: extra.doc || '', outDir, log: [],
  };
  jobs.set(id, job);
  persist(outDir);
  queue.push({ job, config, kind, scriptPath, args, dataDir, outDir });
  pump();
  const ahead = job.state === 'queued' ? queue.length : 0;
  return {
    id, kind, bv: extra.bv || '', state: job.state, position: job.state === 'queued' ? ahead : 0,
    dataDir, doc: job.doc || undefined,
    hint: (job.state === 'queued' ? `排队中（前面还有 ${ahead} 个任务）；` : '') +
      (kind === 'setup' ? '用 bili_asr_status 看安装进度' : '用 bili_asr_status 查进度，完成后用 bili_asr_doc 读文档'),
  };
}

function pump() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  const { job, config, kind, scriptPath, args, dataDir, outDir } = next;
  running = job.id;
  job.state = 'running';
  job.startedAt = Date.now();
  persist(outDir);
  launch(job, config, kind, scriptPath, args, dataDir, outDir);
}

function launch(job, config, kind, scriptPath, args, dataDir, outDir) {
  try { mkdirSync(dataDir, { recursive: true }); } catch { /* 目录建不出来就交给子进程报错 */ }
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: dataDir,
    env: childEnv(config, dataDir),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  job.pid = child.pid;

  const onLine = (line) => {
    if (!line.trim()) return;
    job.log.push(line.slice(0, 400));
    if (job.log.length > 80) job.log.shift();
    try {
      const j = JSON.parse(line);
      if (j.stage === 'view') { job.stage = '读取视频信息'; if (j.title) job.title = j.title; }
      if (j.stage === 'graph') { job.stage = '抓剧情树'; job.done = 0; job.total = j.nodes; }
      if (j.stage === 'audio') { job.stage = '下音轨'; job.done = j.ok; job.total = j.total; }
      if (j.stage === 'subtitle') { job.stage = '查字幕'; job.done = (job.done || 0) + 1; }
      if (j.stage === 'subtitle-summary') { job.stage = '查字幕'; job.done = j.fromSubtitle; job.total = j.fromSubtitle + j.remaining; }
      if (j.stage === 'targets') { job.stage = '准备转写'; job.total = j.count; }
      if (j.stage === 'done' && typeof j.i === 'number') { job.stage = '转写'; job.done = j.i; job.total = j.n; }
      if (j.stage === 'finished') { job.stage = '出文档'; job.done = j.ok; job.total = j.total; }
      if (j.stage === 'exec') job.stage = '安装环境';
      if (j.stage === 'model-file') job.stage = '下载模型';
      if (j.stage === 'done' && j.out) { job.state = 'done'; job.doc = j.out; }
      if (j.stage === 'setup-done') job.state = 'done';
      if (j.stage === 'setup-failed') job.state = 'failed';
      if (j.stage === 'error') {
        job.error = { code: j.code || 'UNKNOWN', message: j.message || '', hint: j.hint || '' };
        job.stage = '失败';
      }
    } catch { /* python 的 stage 行不是 JSON，忽略 */ }
  };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    lines.forEach(onLine);
  });
  child.stderr.on('data', (d) => onLine(d.toString('utf8').trim()));
  let settled = false;
  const done = (code, err) => {
    if (settled) return;
    settled = true;
    if (buf.trim()) onLine(buf);
    job.exitCode = code;
    if (err) { job.state = 'failed'; job.error = { code: 'SPAWN_FAILED', message: err, hint: '子进程没起来：检查 Node 与插件目录权限。' }; }
    else if (job.state !== 'done' && job.state !== 'canceled') job.state = code === 0 ? 'done' : 'failed';
    if (job.state === 'failed' && !job.error) {
      job.error = { code: 'EXIT_' + code, message: '子进程退出码 ' + code, hint: '看 bili_asr_status 的 log 最后几行定位；缺环境会显示 SETUP_REQUIRED。' };
    }
    job.endedAt = Date.now();
    running = null;
    persist(outDir);
    pump();
  };
  child.on('exit', (code) => done(code));
  child.on('error', (e) => done(-1, e.message));
}

/** 取消任务：排队中的直接出队；运行中的杀掉整棵进程树（node → python） */
function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return { error: '没有这个任务: ' + id };
  if (job.state === 'canceled') return { ok: true, id, state: 'canceled', note: '已经取消过了' };
  if (job.state === 'done' || job.state === 'failed' || job.state === 'interrupted') {
    return { error: '任务已结束（' + job.state + '），不能取消' };
  }
  if (job.state === 'canceled') {
    return { state: 'canceled', text: '任务已取消；已下载的音轨与已转写的片段仍保留在目录里', hint: '重新发起即可继续' };
  }
  if (job.state === 'queued') {
    const i = queue.findIndex((q) => q.job.id === id);
    if (i >= 0) queue.splice(i, 1);
    job.state = 'canceled';
    job.endedAt = Date.now();
    job.canceledAt = job.endedAt;
    persist(job.outDir);
    return { ok: true, id, state: 'canceled', killed: false };
  }
  // running
  job.state = 'canceled';
  job.canceledAt = Date.now();
  job.endedAt = job.canceledAt;
  const pid = job.pid;
  if (pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch { /* 进程可能已退出 */ }
  }
  persist(job.outDir);
  return { ok: true, id, state: 'canceled', killed: !!pid };
}

/** 删除任务记录；files=true 时连 works/<BV>/ 一起删。运行中的必须先取消。 */
function deleteJob(id, opts = {}) {
  const job = jobs.get(id);
  if (!job) return { error: '没有这个任务: ' + id };
  if (job.state === 'running' || job.state === 'queued') {
    return { error: '任务还在跑/排队：先取消，再删除' };
  }
  jobs.delete(id);
  persist(job.outDir);
  let removedFiles = false;
  if (opts.files && job.bv) {
    try {
      rmSync(join(job.outDir, job.bv), { recursive: true, force: true });
      removedFiles = true;
    } catch { /* 目录可能已被删 */ }
  }
  return { ok: true, id, bv: job.bv, removedFiles };
}

function secondsOf(job) {
  if (job.state === 'running') return Math.round((Date.now() - job.startedAt) / 1000);
  if (job.endedAt) return Math.round((job.endedAt - job.startedAt) / 1000);
  return 0; // 排队中 / 已中断但没记录结束时间的，不要再涨
}

function statusOf(id) {
  if (!id) {
    return [...jobs.values()].slice(-10).reverse().map((j) => ({
      id: j.id, kind: j.kind, bv: j.bv, title: j.title, state: j.state,
      errorCode: j.error ? j.error.code : undefined,
      seconds: secondsOf(j),
      position: j.state === 'queued' ? queue.findIndex((q) => q.job.id === j.id) + 1 : 0,
      progressText: j.state === 'running' && j.stage
        ? (j.total ? `${j.stage} ${j.done}/${j.total}` : `${j.stage}…`)
        : undefined,
    }));
  }
  const job = jobs.get(id);
  if (!job) return { error: '没有这个任务: ' + id };
  const out = {
    id: job.id, kind: job.kind, bv: job.bv, title: job.title, state: job.state,
    seconds: secondsOf(job),
  };
  if (job.state === 'queued') {
    out.position = queue.findIndex((q) => q.job.id === job.id) + 1;
    out.progressText = '排队中（第 ' + out.position + ' 位）';
  }
  if (job.doc) out.doc = job.doc;
  if (job.state === 'running' && job.stage) {
    out.stage = job.stage;
    out.progressText = job.total ? `${job.stage} ${job.done}/${job.total}` : `${job.stage}…`;
  }
  if (job.note) out.note = job.note;
  if (job.error) { out.error = job.error; out.hint = job.error.hint; }
  if (job.canceledAt) out.canceledAt = new Date(job.canceledAt).toISOString();
  if (job.state === 'done' && job.doc && existsSync(job.doc)) out.docChars = readFileSync(job.doc, 'utf8').length;
  if (job.exitCode !== undefined && job.state !== 'done') out.exitCode = job.exitCode;
  out.log = job.log.slice(-8);
  return out;
}

function docOf(id, offset = 0, limit = 6000) {
  const job = jobs.get(id);
  if (!job) return { error: '没有这个任务: ' + id };
  if (job.state === 'canceled') {
    return { state: 'canceled', text: '任务已取消；已下载的音轨与已转写的片段仍保留在目录里', hint: '重新发起即可继续' };
  }
  if (job.state === 'queued') {
    const pos = queue.findIndex((q) => q.job.id === job.id) + 1;
    return { state: 'queued', text: `排队中（第 ${pos} 位）：前面还有任务在跑，轮到时自动开始`, hint: '任务串行执行，避免几个 ASR 抢 CPU' };
  }
  if (job.state === 'running') {
    const p2 = job.total ? `${job.done}/${job.total}` : '';
    return { state: 'running', text: `正在${job.stage || '处理'}${p2 ? '（' + p2 + '）' : ''}，完成后这里会显示文档`, hint: '还在跑，先用 bili_asr_status 看进度' };
  }
  if (job.state === 'failed' && job.error) {
    return { state: 'failed', text: `失败：${job.error.message}\n\n怎么办：${job.error.hint}\n\n（错误码 ${job.error.code}）` };
  }
  if (job.state === 'interrupted') {
    return { state: 'interrupted', text: job.note || '上次运行在客户端退出时中断了；重新发起即可，已下载的音轨与已转写的片段会复用。' };
  }
  if (!job.doc || !existsSync(job.doc)) return { state: job.state, error: '没有文档: ' + (job.doc || '(setup 任务)') };
  const text = readFileSync(job.doc, 'utf8');
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + limit);
  return { state: 'ok', doc: job.doc, total: text.length, offset: start,
           next: end < text.length ? end : null, text: text.slice(start, end) };
}

/* ---------- 宿主 HTTP（给客户端半端用） ---------- */

const sendJson = (res, code, body) => {
  try {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  } catch { /* 连接已断 */ }
};

const sameOriginOk = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
};

function makeFence(ctx, log) {
  let conn = null;
  let tried = false;
  const getConnection = () => {
    if (tried) return conn;
    tried = true;
    const tries = [
      () => (typeof ctx.get === 'function' ? ctx.get('connection') : null),
      () => Reflect.get(ctx, 'connection'),
      () => (ctx.root && typeof ctx.root === 'object' ? ctx.root.connection : null),
    ];
    for (const fn of tries) {
      try {
        const c = fn();
        if (c && typeof c.requestRejection === 'function') { conn = c; return conn; }
      } catch { /* 换下一个 */ }
    }
    log?.('⚠️ 拿不到 connection.requestRejection，退回本机同源这一道');
    return null;
  };
  return (req, res) => {
    const c = getConnection();
    if (!c) return false;
    try {
      const rejection = c.requestRejection({ headers: req.headers });
      if (rejection === undefined) return false;
      res.statusCode = typeof rejection === 'number' ? rejection : 403;
      try { res.end(); } catch { /* 忽略 */ }
      return true;
    } catch {
      res.statusCode = 403;
      try { res.end(); } catch { /* 忽略 */ }
      return true;
    }
  };
}

async function readBody(req, cap = 64 * 1024) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { if (data.length < cap) data += c; });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

export function apply(ctx, config = {}) {
  const { outDir } = pathsOf(config);
  const log = (m) => { try { ctx.logger?.info?.(`[bili-asr] ${m}`); } catch { /* 没有 logger */ } };
  loadPersisted(outDir);

  /* 工具（会话里调用） */
  const tool = (spec) => ctx.tools.register(defineTool({
    output: {
      schema: { type: 'string' },
      render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
    },
    async execute(args) {
      try { return JSON.stringify(spec.run(args, config), null, 2); }
      catch (e) { return JSON.stringify({ error: String(e?.message || e) }); }
    },
    ...spec,
  }));

  tool({
    name: 'bili_asr_setup',
    description: '一次性安装 bili-asr 运行环境：建 Python venv、装 faster-whisper、下载 Whisper small 模型（约 486MB，sha256 校验）。异步：返回 taskId，用 bili_asr_status 看进度。首次使用前跑一次。',
    parameters: {
      pipIndex: { type: 'string', description: '可选，PyPI 源，默认清华镜像', required: false },
      hfEndpoint: { type: 'string', description: '可选，模型下载站，默认 https://hf-mirror.com', required: false },
    },
    run: (args, cfg) => startProc(
      { ...cfg, pipIndex: args.pipIndex || cfg?.pipIndex, hfEndpoint: args.hfEndpoint || cfg?.hfEndpoint },
      'setup', SETUP, [],
    ),
  });

  tool({
    name: 'bili_asr_run',
    description: '把 B站视频的音频转成文字（B站大多没有字幕轨，这条走本地 Whisper）。互动视频会自动抓 stein 剧情树，输出分支+台词；普通视频逐分P输出。异步：返回 taskId，用 bili_asr_status 查进度、bili_asr_doc 读文档。',
    parameters: {
      video: { type: 'string', description: 'BV 号或含 BV 的 B站链接', required: true },
      pages: { type: 'string', description: '可选，只做指定分P，如 "1,3"；省略做全部分P', required: false },
      noAsr: { type: 'boolean', description: '可选，只抓结构与音轨、不跑 ASR（互动视频调试用）', required: false },
      frames: { type: 'boolean', description: '可选，给每个分P/节点抓一帧截图（写进 frames/，会在文档里出图）', required: false },
      at: { type: 'integer', description: '可选，截图取第几秒（默认 1；会自动避开黑帧）', required: false },
    },
    run: (args, cfg) => {
      const bv = bvOf(args.video);
      if (!bv) throw new Error('没有识别到 BV 号：' + args.video);
      const extra = [];
      if (args.pages) extra.push('--pages', String(args.pages));
      if (args.noAsr) extra.push('--no-asr');
      if (args.frames) extra.push('--frames');
      if (typeof args.at === 'number' || (typeof args.at === 'string' && args.at !== '')) extra.push('--at', String(args.at));
      const { outDir: od } = pathsOf(cfg);
      return startProc(cfg, 'transcribe', CLI, [bv, '--out', od, ...extra], {
        bv, doc: join(od, bv, 'script.md'),
      });
    },
  });

  tool({
    name: 'bili_asr_cancel',
    description: '取消一个正在跑或排队中的 bili-asr 任务。运行中的会杀掉整棵进程树（node → python），已下载的音轨和已转写的片段保留。',
    parameters: { id: { type: 'string', description: '任务 id', required: true } },
    run: (args) => cancelJob(args.id),
  });

  tool({
    name: 'bili_asr_delete',
    description: '删除一个已结束的 bili-asr 任务记录（运行中/排队中的要先取消）。files=true 时把 works/<BV>/ 产物目录一并删除，不可恢复。',
    parameters: {
      id: { type: 'string', description: '任务 id', required: true },
      files: { type: 'boolean', description: '可选，同时删除产物目录', required: false },
    },
    run: (args) => deleteJob(args.id, { files: !!args.files }),
  });

  tool({
    name: 'bili_asr_status',
    description: '查 bili-asr 任务进度：给 id 返回状态与最近日志；不给 id 返回最近 10 个任务。',
    parameters: { id: { type: 'string', description: '任务 id；省略则列出最近任务', required: false } },
    run: (args) => statusOf(args.id),
  });

  tool({
    name: 'bili_asr_doc',
    description: '读 bili-asr 已完成任务的文档（script.md），分页返回；next 非空时用它继续读。',
    parameters: {
      id: { type: 'string', description: '任务 id', required: true },
      offset: { type: 'integer', description: '起始字符偏移，默认 0', required: false },
      limit: { type: 'integer', description: '本次读取字符数，默认 6000', required: false },
    },
    run: (args) => docOf(args.id, Number(args.offset) || 0, Number(args.limit) || 6000),
  });

  /* HTTP 路由（客户端半端 / 浏览器页面调用） */
  const fenceReject = makeFence(ctx, log);
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/bili-asr',
      handler: async (req, res) => {
        if (fenceReject(req, res)) return;
        if (!sameOriginOk(req)) { sendJson(res, 403, { ok: false, error: '只接受本机同源请求' }); return; }
        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); } catch { sendJson(res, 400, { ok: false, error: 'bad url' }); return; }
        const sub = url.pathname.replace(/^\/api\/bili-asr/, '') || '/';
        try {
          if (sub === '/jobs' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, jobs: statusOf(undefined), dataDir: pathsOf(config).dataDir });
            return;
          }
          if (sub === '/job' && req.method === 'GET') {
            sendJson(res, 200, { ok: true, job: statusOf(url.searchParams.get('id') || '') });
            return;
          }
          if (sub === '/doc' && req.method === 'GET') {
            const id = url.searchParams.get('id') || '';
            const offset = Number(url.searchParams.get('offset') || 0) || 0;
            const limit = Math.min(Number(url.searchParams.get('limit') || 8000) || 8000, 40000);
            sendJson(res, 200, { ok: true, ...docOf(id, offset, limit) });
            return;
          }
          if (sub === '/run' && req.method === 'POST') {
            const body = await readBody(req);
            let args = {};
            try { args = JSON.parse(body || '{}'); } catch { /* 空 body */ }
            const bv = bvOf(args.video);
            if (!bv) { sendJson(res, 400, { ok: false, error: '没有识别到 BV 号' }); return; }
            const extra = [];
            if (args.pages) extra.push('--pages', String(args.pages));
            if (args.noAsr) extra.push('--no-asr');
            if (args.frames) extra.push('--frames');
            if (typeof args.at === 'number' || (typeof args.at === 'string' && args.at !== '')) extra.push('--at', String(args.at));
            const { outDir: od } = pathsOf(config);
            sendJson(res, 200, { ok: true, ...startProc(config, 'transcribe', CLI, [bv, '--out', od, ...extra], {
              bv, doc: join(od, bv, 'script.md'),
            }) });
            return;
          }
          if (sub === '/cancel' && req.method === 'POST') {
            const body = await readBody(req);
            let args = {};
            try { args = JSON.parse(body || '{}'); } catch { /* 允许空 body */ }
            const id = args.id || url.searchParams.get('id') || '';
            if (!id) { sendJson(res, 400, { ok: false, error: '缺少 id' }); return; }
            const r = cancelJob(id);
            if (r.error) { sendJson(res, 400, { ok: false, ...r }); return; }
            sendJson(res, 200, { ok: true, ...r });
            return;
          }
          if (sub === '/delete' && req.method === 'POST') {
            const body = await readBody(req);
            let args = {};
            try { args = JSON.parse(body || '{}'); } catch { /* 空 body */ }
            const id = args.id || url.searchParams.get('id') || '';
            if (!id) { sendJson(res, 400, { ok: false, error: '缺少 id' }); return; }
            const r = deleteJob(id, { files: !!args.files });
            sendJson(res, r.error ? 400 : 200, r.error ? { ok: false, ...r } : r);
            return;
          }
          if (sub === '/setup' && req.method === 'POST') {
            sendJson(res, 200, { ok: true, ...startProc(config, 'setup', SETUP, []) });
            return;
          }
          sendJson(res, 404, { ok: false, error: 'no such endpoint: ' + sub });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err?.message || err) });
        }
      },
    }), 'bili-asr: /api/bili-asr 路由');
    log('HTTP 路由已挂：/api/bili-asr/{jobs,job,doc,run,setup}');
  } catch (e) {
    log('HTTP 路由没挂上：' + (e?.message ?? e));
  }
}
