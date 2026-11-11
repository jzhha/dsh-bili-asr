// 公共工具：路径、请求、日志
//
// 路径全部由环境变量决定，便于别人安装后使用（不再写死本机 G 盘）：
//   BILI_ASR_HOME  数据根目录：venv/ model/ works/ 都在它下面（默认 ~/.dsh/bili-asr）
//   BILI_ASR_MODEL 覆盖模型目录；BILI_ASR_PYTHON 覆盖 venv 解释器
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

export const BIN = dirname(fileURLToPath(import.meta.url));

export const HOME = resolve(
  process.env.BILI_ASR_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'bili-asr'),
);

export const MODEL = process.env.BILI_ASR_MODEL || join(HOME, 'model', 'faster-whisper-small');

export const PYTHON =
  process.env.BILI_ASR_PYTHON ||
  join(HOME, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export const WORKS = join(HOME, 'works');

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
export const headers = (bv) => ({ 'user-agent': UA, referer: `https://www.bilibili.com/video/${bv}/` });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 统一的结构化失败：把"是什么错 + 该怎么办"打给宿主，然后退出 */
export function die(code, message, hint) {
  console.log(JSON.stringify({ stage: 'error', code, message, hint: hint || '' }));
  process.exit(2);
}

/** B站接口错误码 → 可操作提示 */
export function apiHint(code, message) {
  if (code === -412) return { code: 'RATE_LIMITED', hint: '被 B 站风控了（412）。等 5~10 分钟再试；频繁触发时设 BILI_SESSDATA 或换网络出口。' };
  if (code === -404) return { code: 'VIDEO_NOT_FOUND', hint: '视频不存在或已删除，确认 BV 号/链接。' };
  if (code === 62002 || code === 62004) return { code: 'VIDEO_UNAVAILABLE', hint: '视频不可见（私密/审核中/地区限制），换个视频试试。' };
  if (code === -1) return { code: 'NETWORK', hint: '请求没发出去或超时：检查网络/DNS，或在设置里换代理。' };
  return { code: 'API_FAILED', hint: 'B 站接口返回了意料之外的错误码，可带上这段 message 开 issue。' };
}
export const log = (obj) => console.log(JSON.stringify(obj));

/** outRoot 为空时用 <HOME>/works；跨工作区调用时传 --out 指到当前工作区内 */
export function workDir(bv, outRoot = '') {
  const dir = outRoot ? resolve(outRoot, bv) : join(WORKS, bv);
  for (const sub of ['', 'audio', 'transcripts']) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

/** 取 BV 号：支持 BV 号或含 BV 的链接 */
export function parseBvid(input) {
  const m = String(input).match(/BV[0-9A-Za-z]{10}/);
  if (!m) throw new Error('没有识别到 BV 号: ' + input);
  return m[0];
}

export async function getJson(url, bv, tries = 3, cookie = '') {
  for (let i = 0; i < tries; i++) {
    try {
      const h = headers(bv);
      if (cookie) h.cookie = cookie;
      const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(30000) });
      if (res.status === 412) return { code: -412, message: 'HTTP 412（风控）' };
      return await res.json();
    } catch (e) {
      if (i === tries - 1) return { code: -1, message: 'fetch: ' + e.message };
      await sleep(1200 * (i + 1));
    }
  }
}
