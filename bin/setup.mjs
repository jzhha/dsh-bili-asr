#!/usr/bin/env node
// 一次性环境安装：建 venv + 装 faster-whisper + 下 Whisper small 模型（校验 sha256）
//
//   node bin/setup.mjs                        # 全部走默认（清华 PyPI 源 + hf-mirror）
//   node bin/setup.mjs --pip=<url> --hf=<url> # 换镜像
//   node bin/setup.mjs --skip-model           # 只建环境，不下模型
//
// 环境变量：BILI_ASR_HOME / BILI_ASR_PYTHON / BILI_ASR_MODEL / HTTPS_PROXY
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync, renameSync, unlinkSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { HOME, MODEL, log } from './lib.mjs';

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (flag) => process.argv.includes('--' + flag);

const PIP_INDEX = argOf('pip', process.env.BILI_ASR_PIP_INDEX || 'https://pypi.tuna.tsinghua.edu.cn/simple');
const HF_BASE = (argOf('hf', process.env.BILI_ASR_HF || 'https://hf-mirror.com')).replace(/\/+$/, '');
const REVISION = '536b0662742c02347bc0e980a01041f333bce120';
const REPO = 'Systran/faster-whisper-small';
const FILES = [
  { name: 'config.json', bytes: 2370, sha256: 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828' },
  { name: 'model.bin', bytes: 483546902, sha256: '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671' },
  { name: 'tokenizer.json', bytes: 2203239, sha256: 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab' },
  { name: 'vocabulary.txt', bytes: 459861, sha256: '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913' },
];

const VENV = join(HOME, 'venv');
const PY = join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function run(cmd, args, opts = {}) {
  log({ stage: 'exec', cmd: [cmd, ...args].join(' ') });
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 900000, ...opts });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join(' | ');
    throw new Error(`${cmd} 退出码 ${r.status}：${msg}`);
  }
  return (r.stdout || '').trim();
}

function have(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 20000 });
    return r.status === 0;
  } catch { return false; }
}

async function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function download(name, expectedBytes, expectedSha) {
  const dest = join(MODEL, name);
  if (existsSync(dest) && statSync(dest).size === expectedBytes && (await sha256File(dest)) === expectedSha) {
    log({ stage: 'model-file', file: name, state: 'cached' });
    return;
  }
  const url = `${HF_BASE}/${REPO}/resolve/${REVISION}/${name}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const part = dest + '.partial';
    let start = existsSync(part) ? statSync(part).size : 0;
    if (start > expectedBytes) { try { unlinkSync(part); } catch { /* ignore */ } start = 0; }
    log({ stage: 'download', file: name, attempt, from: start, url });
    try {
      const res = await fetch(url, { headers: start ? { range: `bytes=${start}-` } : {}, redirect: 'follow' });
      if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
      const sink = createWriteStream(part, { flags: start ? 'a' : 'w' });
      for await (const chunk of res.body) sink.write(chunk);
      await new Promise((r) => sink.end(r));
      const size = statSync(part).size;
      if (size !== expectedBytes) throw new Error(`大小不符 ${size}/${expectedBytes}`);
      const digest = await sha256File(part);
      if (digest !== expectedSha) { try { unlinkSync(part); } catch { /* ignore */ } throw new Error('sha256 不符'); }
      renameSync(part, dest);
      log({ stage: 'model-file', file: name, state: 'ok', bytes: size });
      return;
    } catch (e) {
      log({ stage: 'download-failed', file: name, attempt, error: String(e.message || e) });
      if (attempt === 6) throw e;
    }
  }
}

const steps = [];
try {
  // 1) 目录
  mkdirSync(HOME, { recursive: true });
  mkdirSync(MODEL, { recursive: true });
  steps.push({ step: 'home', ok: true, path: HOME });

  // 2) venv
  if (!existsSync(PY)) {
    if (have('uv')) {
      run('uv', ['venv', VENV, '--python', argOf('python-version', '3.12')]);
    } else if (have('python')) {
      run('python', ['-m', 'venv', VENV]);
    } else if (have('python3')) {
      run('python3', ['-m', 'venv', VENV]);
    } else {
      throw new Error('没有找到 uv / python / python3。先装 uv（单文件、免管理员）或 Python 3.10+');
    }
  }
  steps.push({ step: 'venv', ok: true, python: PY });

  // 3) 依赖
  if (have('uv')) {
    run('uv', ['pip', 'install', '--python', PY, '--index-url', PIP_INDEX, 'faster-whisper==1.2.1', 'pillow']);
  } else {
    run(PY, ['-m', 'pip', 'install', '--upgrade', 'pip', '--index-url', PIP_INDEX]);
    run(PY, ['-m', 'pip', 'install', '--index-url', PIP_INDEX, 'faster-whisper==1.2.1', 'pillow']);
  }
  steps.push({ step: 'deps', ok: true });

  // 4) 模型
  if (!has('skip-model')) {
    for (const f of FILES) await download(f.name, f.bytes, f.sha256);
    steps.push({ step: 'model', ok: true, path: MODEL });
  }
  log({ stage: 'setup-done', ok: true, home: HOME, python: PY, model: MODEL, steps });
} catch (e) {
  log({ stage: 'setup-failed', ok: false, error: String(e.message || e), hint: '可换镜像：--pip=<url> --hf=<url>；网络走 HTTPS_PROXY' });
  process.exitCode = 2;
}
