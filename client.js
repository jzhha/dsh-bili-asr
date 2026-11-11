// dsh-bili-asr —— 客户端半端：侧栏入口 + 「B站转写」面板
// 数据来自宿主 /api/bili-asr/{jobs,job,doc,run}（同源 fetch，凭据走 cookie）
window.__ModuleLoader__.load({
  id: 'dsh-bili-asr',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const NS = 'dshBiliAsr';
    const PANEL_ID = 'dsh-bili-asr';
    const API = '/api/bili-asr';

    const ZH = {
      nav: 'B站转写',
      title: 'B站转写（本地 Whisper）',
      sub: '互动视频出分支树 + 台词；普通视频出逐段台词。产物在 plugins\\bili-asr\\works\\<BV>\\',
      placeholder: 'BV 号或视频链接',
      run: '转写',
      setup: '装环境',
      setupHint: '首次使用先装环境：建 venv + 下模型（约 486MB）',
      refresh: '刷新',
      empty: '还没有任务',
      running: '转写中',
      done: '完成',
      failed: '失败',
      interrupted: '已中断',
      doc: '文档',
      copy: '复制路径',
      cancel: '取消任务',
      copied: '已复制',
      loading: '读取中…',
      noDoc: '还没有文档',
      err: '出错了',
    };
    const EN = {
      nav: 'Bili ASR',
      title: 'Bilibili → text (local Whisper)',
      sub: 'Interactive videos: branch tree + lines. Normal videos: per-part transcript.',
      placeholder: 'BV id or URL',
      run: 'Transcribe',
      setup: 'Setup',
      setupHint: 'First run: create venv + download model (~486MB)',
      refresh: 'Refresh',
      empty: 'No jobs yet',
      running: 'running',
      done: 'done',
      failed: 'failed',
      interrupted: 'interrupted',
      doc: 'Document',
      copy: 'Copy path',
      cancel: 'Cancel',
      copied: 'Copied',
      loading: 'Loading…',
      noDoc: 'No document yet',
      err: 'Error',
    };

    const CSS = `
.basr-root{display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;padding:18px 20px;font-size:13px}
.basr-head{display:flex;flex-direction:column;gap:4px}
.basr-title{font-size:16px;font-weight:600}
.basr-sub{opacity:.62;font-size:12px;line-height:1.5}
.basr-form{display:flex;gap:8px}
.basr-input{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border,rgba(127,127,127,.28));background:var(--dsw-alias-bg,rgba(127,127,127,.06));color:inherit;font:inherit}
.basr-btn{padding:8px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,rgba(127,127,127,.28));background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.10));color:inherit;cursor:pointer;font:inherit}
.basr-btn:hover{background:rgba(127,127,127,.18)}
.basr-btn[disabled]{opacity:.45;cursor:default}
.basr-body{display:flex;gap:14px;flex:1;min-height:0}
.basr-list{width:300px;flex:none;overflow:auto;display:flex;flex-direction:column;gap:6px}
.basr-item{padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:rgba(127,127,127,.07)}
.basr-item:hover{background:rgba(127,127,127,.14)}
.basr-item.on{border-color:var(--dsw-alias-accent,#4a86ff);background:rgba(74,134,255,.12)}
.basr-row{display:flex;justify-content:space-between;gap:8px;font-size:12px;opacity:.75}
.basr-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
.basr-doc{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.basr-toolbar{display:flex;align-items:center;gap:8px;font-size:12px;opacity:.8}
.basr-pre{flex:1;min-height:0;overflow:auto;margin:0;padding:12px;border-radius:10px;background:rgba(127,127,127,.08);font:12px/1.7 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.basr-err{color:#e5534b}
.basr-entry{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1;cursor:pointer;text-align:left;opacity:.9}
.basr-entry:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.14));opacity:1}
.basr-entry.rail{width:36px;height:36px;justify-content:center;padding:0}
.basr-entry svg{flex:none;opacity:.85}
`;

    let cssInstalled = false;
    function ensureCss() {
      if (cssInstalled) return;
      cssInstalled = true;
      const el = document.createElement('style');
      el.setAttribute('data-dsh-bili-asr', '1');
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    async function asJson(res) {
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { ok: false, error: text.slice(0, 200) }; }
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }));
    const jpost = async (p, body) =>
      asJson(await fetch(API + p, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
      }));

    function BiliAsrPanel({ ctx, t }) {
      const [jobs, setJobs] = useState([]);
      const [input, setInput] = useState('');
      const [busy, setBusy] = useState(false);
      const [sel, setSel] = useState(null);
      const [doc, setDoc] = useState(null);
      const [note, setNote] = useState('');

      const load = useCallback(async () => {
        try {
          const r = await jget('/jobs');
          if (r && r.ok && Array.isArray(r.jobs)) setJobs(r.jobs);
          else setNote((r && r.error) || 'load failed');
        } catch (e) { setNote(String((e && e.message) || e)); }
      }, []);

      useEffect(() => { load(); }, [load]);
      useEffect(() => {
        const anyRunning = jobs.some((j) => j.state === 'running');
        const timer = setInterval(load, anyRunning ? 2500 : 10000);
        return () => clearInterval(timer);
      }, [jobs, load]);

      useEffect(() => {
        if (!sel) { setDoc(null); return; }
        let alive = true;
        setDoc({ loading: true });
        jget('/doc?id=' + encodeURIComponent(sel) + '&limit=40000')
          .then((r) => { if (alive) setDoc(r); })
          .catch((e) => { if (alive) setDoc({ error: String((e && e.message) || e) }); });
        return () => { alive = false; };
      }, [sel]);

      const run = async () => {
        const video = (input || '').trim();
        if (!video || busy) return;
        setBusy(true); setNote('');
        try {
          const r = await jpost('/run', { video });
          if (r && r.ok) { setSel(r.id); setInput(''); load(); }
          else setNote((r && (r.error || r.hint)) || 'run failed');
        } catch (e) { setNote(String((e && e.message) || e)); }
        setBusy(false);
      };

      const setup = async () => {
        if (busy) return;
        setBusy(true); setNote(t('setupHint'));
        try {
          const r = await jpost('/setup', {});
          if (r && r.ok) { setSel(r.id); setNote(t('setup') + ' · ' + (r.id || '')); load(); }
          else setNote((r && r.error) || 'setup failed');
        } catch (e) { setNote(String((e && e.message) || e)); }
        setBusy(false);
      };
      const copyPath = async () => {
        const p = doc && doc.doc;
        if (!p) return;
        try { await navigator.clipboard.writeText(p); setNote(t('copied')); }
        catch { setNote(p); }
      };

      const cancel = async () => {
        if (!sel) return;
        try {
          const r = await jpost('/cancel', { id: sel });
          setNote(r && r.ok ? '已取消 ' + sel : ((r && r.error) || '取消失败'));
        } catch (e) { setNote(String((e && e.message) || e)); }
        await load();
      };

      const stateText = (s) => (s === 'running' ? t('running') : s === 'failed' ? t('failed') : s === 'interrupted' ? t('interrupted') : t('done'));

      return h('div', { className: 'basr-root' },
        h('div', { className: 'basr-head' },
          h('div', { className: 'basr-title' }, t('title')),
          h('div', { className: 'basr-sub' }, t('sub'))
        ),
        h('div', { className: 'basr-form' },
          h('input', {
            className: 'basr-input', value: input, placeholder: t('placeholder'),
            onChange: (e) => setInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') run(); },
          }),
          h('button', { className: 'basr-btn', disabled: busy, onClick: run }, busy ? '…' : t('run')),
          h('button', { className: 'basr-btn', disabled: busy, onClick: setup }, t('setup')),
          h('button', { className: 'basr-btn', onClick: load }, t('refresh'))
        ),
        note ? h('div', { className: 'basr-sub' }, note) : null,
        h('div', { className: 'basr-body' },
          h('div', { className: 'basr-list' },
            jobs.length === 0 ? h('div', { className: 'basr-sub' }, t('empty')) :
              jobs.map((j) => h('div', {
                key: j.id,
                className: 'basr-item' + (j.id === sel ? ' on' : ''),
                onClick: () => setSel(j.id),
              },
                h('span', { className: 'basr-name' }, (j.title || j.bv) + ''),
                h('span', { className: 'basr-row' },
                  h('span', null, j.bv),
                  h('span', null, stateText(j.state) + (j.state === 'failed' && j.errorCode ? ' · ' + j.errorCode : '') + (j.state === 'queued' && j.position ? ' · 第' + j.position + '位' : '') + (j.progressText ? ' · ' + j.progressText : '') + (j.seconds ? ' · ' + j.seconds + 's' : ''))
                )
              ))
          ),
          h('div', { className: 'basr-doc' },
            h('div', { className: 'basr-toolbar' },
              h('span', null, t('doc') + (doc && doc.doc ? '：' + doc.doc : '')),
              h('button', { className: 'basr-btn', disabled: !(doc && doc.doc), onClick: copyPath }, t('copy')),
              h('button', {
                className: 'basr-btn',
                disabled: !(jobs.find((x) => x.id === sel) && ['running', 'queued'].includes(jobs.find((x) => x.id === sel).state)),
                onClick: cancel,
              }, t('cancel'))
            ),
            h('pre', { className: 'basr-pre' },
              !sel ? t('noDoc') :
                doc && doc.loading ? t('loading') :
                  doc && doc.error ? h('span', { className: 'basr-err' }, t('err') + '：' + doc.error) :
                    (doc && doc.text) || t('noDoc')
            )
          )
        )
      );
    }

    function EntryIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 1.5, y: 3.5, width: 13, height: 9, rx: 2, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M6.4 6.6l3.1 1.4-3.1 1.4z', fill: 'currentColor' })
      );
    }

    function apply(ctx) {
      ctx.effect(() => ensureCss(), 'dsh-bili-asr-style');

      let t = (k) => k;
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-bili-asr-locale');
        t = ctx.locale.bind(NS);
      } catch (err) {
        console.warn('[dsh-bili-asr] locale registration failed', err);
      }
      const label = () => { try { return t('nav'); } catch { return 'B站转写'; } };

      let layout;
      try {
        ctx.inject(['layout'], (scoped) => { layout = scoped.layout; });
      } catch (err) {
        console.error('[dsh-bili-asr] layout inject failed', err);
      }
      const openPanel = () => {
        try { if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID); }
        catch (err) { console.error('[dsh-bili-asr] cannot open panel', err); }
      };

      const FooterEntry = (ownerProps) => {
        const wide = !!(ownerProps && ownerProps.wide);
        return h('button', {
          type: 'button',
          className: 'basr-entry' + (wide ? ' wide' : ' rail'),
          title: label(), 'aria-label': label(), onClick: openPanel,
        }, h(EntryIcon), wide ? h('span', null, label()) : null);
      };

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: PANEL_ID, order: 11, locale: NS, label },
          FooterEntry
        )
      );

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ ctx, t }) },
          BiliAsrPanel
        )
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
