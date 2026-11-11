// 平台字幕轨优先：能拿到字幕就不跑 ASR（省 CPU，也更准）
//
// B站字幕接口：
//   /x/player/v2?bvid=&cid=   → data.subtitle.subtitles[] （lan / lan_doc / subtitle_url / id）
//   subtitle_url              → JSON { body: [{ from, to, content }] }
// 匿名大多数情况下返回 0 条；带 SESSDATA 后更容易拿到 AI 字幕。
// 传凭据的方式：环境变量 BILI_SESSDATA（只取这一段 cookie），或 BILI_COOKIE（整段 cookie 头）。

import { getJson, sleep } from './lib.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export function cookieHeader() {
  if (process.env.BILI_COOKIE) return process.env.BILI_COOKIE.trim();
  const sess = process.env.BILI_SESSDATA;
  return sess ? 'SESSDATA=' + sess.trim() : '';
}

function normalizeUrl(u) {
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http://')) return 'https://' + u.slice(7);
  return u;
}

/** 把字幕 JSON 的 body 转成和 ASR 一样的 segments 结构 */
export function parseSubtitleJson(json) {
  const body = Array.isArray(json?.body) ? json.body : [];
  const segments = body
    .map((x) => ({
      start: Number(x.from) || 0,
      end: Number(x.to) || 0,
      text: String(x.content ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text);
  const text = segments.map((s) => s.text).join('');
  return { segments, text };
}

/** 查一个 cid 有没有可用字幕轨；返回 { url, lan, lanDoc } 或 null */
export async function probeSubtitle(bv, cid) {
  const j = await getJson(`https://api.bilibili.com/x/player/v2?bvid=${bv}&cid=${cid}`, bv, 2, cookieHeader());
  if (j.code !== 0) return null;
  const list = j.data?.subtitle?.subtitles || [];
  if (!list.length) return null;
  const preferred = list.find((s) => /zh/i.test(s.lan || '')) || list[0];
  const url = normalizeUrl(preferred.subtitle_url);
  if (!url) return null;
  return { url, lan: preferred.lan || '', lanDoc: preferred.lan_doc || '', needLogin: !!j.data?.need_login_subtitle };
}

/** 拉字幕正文；失败返回 null（调用方回退 ASR） */
export async function fetchSubtitle(bv, track) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(track.url, {
        headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bv}/`, ...(cookieHeader() ? { cookie: cookieHeader() } : {}) },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const parsed = parseSubtitleJson(json);
      if (!parsed.segments.length) return null;
      return parsed;
    } catch {
      if (attempt === 2) return null;
      await sleep(800);
    }
  }
  return null;
}
