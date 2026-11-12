#!/usr/bin/env node
// 环境自检：python / 依赖 / 模型 / 数据目录 / 网络，一次跑完给出可操作结论
//   node bin/doctor.mjs [--deep]   # --deep 会算 483MB 模型文件的 sha256
import { existsSync, statSync, mkdirSync, writeFileSync, unlinkSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, MODEL, PYTHON } from './lib.mjs';

const deep = process.argv.includes('--deep');
const checks = [];
const add = (name, ok, detail, hint) => checks.push({ name, ok: !!ok, detail: detail || '', hint: ok ? '' : (hint || '') });

// 1) 数据目录可写
try {
  mkdirSync(HOME, { recursive: true });
  const probe = join(HOME, '.doctor-probe');
  writeFileSync(probe, 'ok');
  unlinkSync(probe);
  add('数据目录', true, HOME);
} catch (e) {
  add('数据目录', false, `${HOME} 不可写：${e.message}`, '检查目录权限，或用配置 dataDir 换一个可写目录。');
}

// 2) Python
if (!existsSync(PYTHON)) {
  add('Python 环境', false, `找不到 ${PYTHON}`, '跑一次 bili_asr_setup（或 node bin/setup.mjs）。');
} else {
  const v = spawnSync(PYTHON, ['--version'], { encoding: 'utf8', timeout: 20000 });
  add('Python 环境', v.status === 0, (v.stdout || v.stderr || '').trim(), 'venv 可能坏了：删掉 dataDir/venv 重新 setup。');

  // 3) 依赖
  const imp = spawnSync(PYTHON, ['-c', 'import faster_whisper, av, PIL; print("ok")'], { encoding: 'utf8', timeout: 60000 });
  add('依赖（faster-whisper / av / Pillow）', imp.status === 0 && (imp.stdout || '').includes('ok'),
    imp.status === 0 ? 'import ok' : (imp.stderr || '').trim().split('\n').slice(-2).join(' | '),
    '重跑 bili_asr_setup；它会补齐 faster-whisper 与 pillow。');
}

// 4) 模型
const files = [
  ['model.bin', 483546902], ['config.json', 2370], ['tokenizer.json', 2203239], ['vocabulary.txt', 459861],
];
const missing = files.filter(([n, size]) => {
  const p = join(MODEL, n);
  return !existsSync(p) || (size && statSync(p).size !== size);
});
add('Whisper 模型', missing.length === 0, missing.length ? '缺失/大小不符：' + missing.map(([n]) => n).join(', ') : MODEL,
  '重跑 bili_asr_setup：它会续传并校验 sha256。');

if (deep && missing.length === 0) {
  const { createHash } = await import('node:crypto');
  const { createReadStream } = await import('node:fs');
  const want = '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671';
  const digest = await new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(join(MODEL, 'model.bin'))
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej);
  });
  add('模型 sha256', digest === want, digest === want ? 'model.bin 校验通过' : 'model.bin sha256 不匹配',
    '重跑 bili_asr_setup 重新下载/校验。');
}

// 5) 磁盘空间
try {
  const st = statfsSync(HOME);
  const freeGB = Math.round((st.bavail * st.bsize) / 1024 ** 3 * 10) / 10;
  add('磁盘空间', freeGB >= 2, freeGB + ' GB 可用', '至少留 2 GB（一个视频的音轨+转写通常几十 MB）。');
} catch {
  add('磁盘空间', true, '无法读取（跳过）');
}

// 6) B站接口可达
try {
  const res = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=BV1d8pU6xEZX', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  add('B站接口', j.code === 0, 'HTTP ' + res.status + ' / code ' + j.code,
    j.code === -412 ? '被风控（412），等几分钟或设 BILI_SESSDATA。' : '检查网络/DNS 或代理。');
} catch (e) {
  add('B站接口', false, String(e.message || e).slice(0, 120), '检查网络/DNS 或代理。');
}

const ok = checks.every((c) => c.ok);
console.log(JSON.stringify({ stage: 'doctor', ok, home: HOME, python: PYTHON, model: MODEL, checks }, null, 1));
process.exit(ok ? 0 : 3);
