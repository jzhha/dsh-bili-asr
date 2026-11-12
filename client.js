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
      queued: '排队中',
      canceled: '已取消',
      done: '完成',
      failed: '失败',
      interrupted: '已中断',
      doc: '文档',
      copy: '复制路径',
      cancel: '取消任务',
      frames: '节点截图',
      del: '删除',
      delFiles: '连产物一起删',
      confirmDel: '确认删除？',
      frameHint: '每个分P/节点抓一帧（约 25 KB/张，自动跳过黑帧）',
      frameAt: '取第几秒',
      srt: '导出字幕',
      parts: '分P',
      partsHint: '如 1,3；留空=全部分P',
      rebuild: '重建文档',
      doctor: '环境自检',
      doctorBusy: '自检中…',
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
      queued: 'queued',
      canceled: 'canceled',
      done: 'done',
      failed: 'failed',
      interrupted: 'interrupted',
      doc: 'Document',
      copy: 'Copy path',
      cancel: 'Cancel',
      frames: 'Frames',
      copied: 'Copied',
      loading: 'Loading…',
      noDoc: 'No document yet',
      frameAt: 'At',
      frameHint: 'One still per part/node (~25 KB, dark frames skipped)',
      srt: 'SRT',
      parts: 'Parts',
      partsHint: 'e.g. 1,3 — empty means all parts',
      rebuild: 'Rebuild',
      doctor: 'Doctor',
      doctorBusy: 'Checking…',
      del: 'Delete',
      delFiles: 'with files',
      confirmDel: 'Confirm?',
      interrupted: 'interrupted',
      err: 'Error',
    };

    const CSS = `
.basr-root{display:flex;flex-direction:column;gap:10px;padding:0;font-size:13px;max-width:1040px}
.basr-head{display:flex;flex-direction:column;gap:4px}
.basr-title{font-size:16px;font-weight:600}
.basr-sub{opacity:.62;font-size:12px;line-height:1.5}
.basr-form{display:flex;gap:8px;align-items:center}
.basr-input{flex:1 1 auto;min-width:140px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border,rgba(127,127,127,.28));background:var(--dsw-alias-bg,rgba(127,127,127,.06));color:inherit;font:inherit}
.basr-btn{flex:none;white-space:nowrap;padding:7px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border,rgba(127,127,127,.28));background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.10));color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:1.2}
.basr-btn:hover{background:rgba(127,127,127,.18)}
.basr-btn[disabled]{opacity:.45;cursor:default}
.basr-opts{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:22px}
.basr-body{display:grid;grid-template-columns:minmax(240px,320px) minmax(0,1fr);gap:12px;align-items:start}
.basr-list{max-height:52vh;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
.basr-item{min-width:0;padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent;background:rgba(127,127,127,.07)}
.basr-item:hover{background:rgba(127,127,127,.14)}
.basr-item.on{border-color:var(--dsw-alias-accent,#4a86ff);background:rgba(74,134,255,.12)}
.basr-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;font-size:12.5px}
.basr-row{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;opacity:.7;white-space:nowrap}
.basr-row>span:last-child{overflow:hidden;text-overflow:ellipsis;text-align:right}
.basr-doc{min-width:0;display:flex;flex-direction:column;gap:8px}
.basr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.basr-docpath{flex:1 1 180px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.6;font-size:11.5px}
.basr-pre{min-height:220px;max-height:52vh;overflow:auto;margin:0;padding:12px;border-radius:10px;background:rgba(127,127,127,.08);font:12px/1.7 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.basr-err{color:#e5534b}
.basr-entry{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1;cursor:pointer;text-align:left;opacity:.9}
.basr-entry:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.14));opacity:1}
.basr-entry.rail{width:36px;height:36px;justify-content:center;padding:0}
.basr-entry svg{flex:none;opacity:.85}
.basr-check{display:flex;align-items:center;gap:6px;font-size:12px;opacity:.85;white-space:nowrap;cursor:pointer}
.basr-menu-wrap{position:relative;display:inline-block;flex:none}
.basr-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:200px;padding:6px;border-radius:10px;z-index:30;
  background:var(--dsw-alias-bg,#202020);border:1px solid var(--dsw-alias-border,rgba(127,127,127,.3));
  box-shadow:0 10px 28px rgba(0,0,0,.35)}
.basr-menu-item{padding:8px 10px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;opacity:.92}
.basr-menu-item:hover{background:rgba(127,127,127,.16);opacity:1}
.basr-menu-item.danger{color:#e5534b}
.basr-menu-tip{padding:6px 10px 2px;font-size:11px;opacity:.5;white-space:nowrap}
.basr-menu-backdrop{position:fixed;inset:0;z-index:20;background:transparent}
.basr-parts{width:64px;padding:3px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border,rgba(127,127,127,.28));background:transparent;color:inherit;font:inherit;font-size:12px}
.basr-select{padding:3px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border,rgba(127,127,127,.28));background:transparent;color:inherit;font:inherit;font-size:12px}
@media (max-width:760px){.basr-body{grid-template-columns:1fr}.basr-list{max-height:30vh}}
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
      const [wantFrames, setWantFrames] = useState(false);
      const [frameAt, setFrameAt] = useState('1');
      const [confirming, setConfirming] = useState('');
      const [menuOpen, setMenuOpen] = useState(false);
      const [wantSrt, setWantSrt] = useState(false);
      const [parts, setParts] = useState('');
      const [doctorBusy, setDoctorBusy] = useState(false);
      const [sel, setSel] = useState(null);
      const [doc, setDoc] = useState(null);
      const [selState, setSelState] = useState('');
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
        if (!sel) { setDoc(null); setSelState(''); return; }
        let alive = true;
        setDoc({ loading: true });
        jget('/job?id=' + encodeURIComponent(sel))
          .then((r) => { if (alive && r && r.ok && r.job) setSelState(r.job.state || ''); })
          .catch(() => {});
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
          const r = await jpost('/run', { video, frames: wantFrames, at: wantFrames ? Number(frameAt) : undefined, srt: wantSrt, pages: parts.trim() || undefined });
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

      const runDoctor = async () => {
        if (doctorBusy) return;
        setDoctorBusy(true);
        setDoc({ loading: true });
        try {
          const r = await jpost('/doctor', {});
          const rep = r && r.report;
          if (!rep) { setDoc({ error: (r && r.error) || '自检失败' }); return; }
          const lines = [
            (rep.ok ? '✅ 环境正常' : '⚠️ 有问题需要处理'),
            'home: ' + (rep.home || ''),
            '',
            ...(rep.checks || []).map((c) => (c.ok ? '✅ ' : '❌ ') + c.name + '：' + (c.detail || '') + (c.ok || !c.hint ? '' : '\n    → ' + c.hint)),
          ];
          setDoc({ text: lines.join('\n') });
        } catch (e) { setDoc({ error: String((e && e.message) || e) }); }
        setDoctorBusy(false);
      };

      const rebuildDoc = async () => {
        if (!sel) return;
        try {
          const r = await jpost('/rebuild', { id: sel, srt: wantSrt });
          if (r && r.ok) { setNote('正在重建文档…'); if (r.id) setSel(r.id); load(); }
          else setNote((r && r.error) || '重建失败');
        } catch (e) { setNote(String((e && e.message) || e)); }
      };

      const delJob = async (withFiles) => {
        if (!sel) return;
        try {
          const r = await jpost('/delete', { id: sel, files: withFiles });
          setNote(r && r.ok ? (withFiles ? '已删除任务与产物目录' : '已删除任务记录') : ((r && r.error) || '删除失败'));
          if (r && r.ok) { setSel(null); setConfirming(''); }
        } catch (e) { setNote(String((e && e.message) || e)); }
        await load();
      };

      const cancel = async () => {
        if (!sel) return;
        try {
          const r = await jpost('/cancel', { id: sel });
          setNote(r && r.ok ? '已取消 ' + sel : ((r && r.error) || '取消失败'));
        } catch (e) { setNote(String((e && e.message) || e)); }
        await load();
      };

      // 以宿主查询到的状态为准：列表只显示最近 10 条，旧任务被选中后也能正确判断
      const delable = ['done', 'failed', 'canceled', 'interrupted'].includes(selState);
      const cancellable = ['running', 'queued'].includes(selState);

      const STATE_KEY = { running: 'running', queued: 'queued', done: 'done', failed: 'failed', canceled: 'canceled', interrupted: 'interrupted' };
      useEffect(() => { if (!delable) { setMenuOpen(false); setConfirming(''); } }, [delable]);

      const stateText = (s) => { const key = STATE_KEY[s] || 'done'; const v = t(key); return v && v !== key ? v : key; };

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
        h('div', { className: 'basr-opts' },
          h('label', { className: 'basr-check', title: t('frameHint') },
            h('input', { type: 'checkbox', checked: wantFrames, onChange: (e) => setWantFrames(e.target.checked) }),
            h('span', null, t('frames'))
          ),
          wantFrames ? h('label', { className: 'basr-check' },
            h('span', { className: 'basr-sub' }, t('frameAt')),
            h('select', {
              className: 'basr-select', value: frameAt,
              onChange: (e) => setFrameAt(e.target.value),
            }, ['0', '1', '3', '5', '10'].map((v) => h('option', { key: v, value: v }, v + 's')))
          ) : null,
          h('label', { className: 'basr-check' },
            h('input', { type: 'checkbox', checked: wantSrt, onChange: (e) => setWantSrt(e.target.checked) }),
            h('span', null, t('srt'))
          ),
          h('label', { className: 'basr-check', title: t('partsHint') },
            h('span', { className: 'basr-sub' }, t('parts')),
            h('input', {
              className: 'basr-parts', value: parts, placeholder: '1,3',
              onChange: (e) => setParts(e.target.value.replace(/[^0-9,]/g, '')),
            })
          ),
          h('span', { className: 'basr-sub' }, wantFrames ? t('frameHint') : '')
        ),
        note ? h('div', { className: 'basr-sub' }, note) : null,
        h('div', { className: 'basr-body' },
          h('div', { className: 'basr-list' },
            jobs.length === 0 ? h('div', { className: 'basr-sub' }, t('empty')) :
              jobs.map((j) => h('div', {
                key: j.id,
                className: 'basr-item' + (j.id === sel ? ' on' : ''),
                onClick: () => { setSel(j.id); setMenuOpen(false); setConfirming(''); },
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
              h('span', { className: 'basr-docpath', title: (doc && doc.doc) || '' }, t('doc') + (doc && doc.doc ? '：' + doc.doc : '')),
              h('button', { className: 'basr-btn', disabled: !(doc && doc.doc), onClick: copyPath }, t('copy')),
              h('button', {
                className: 'basr-btn',
                disabled: !cancellable,
                onClick: cancel,
              }, t('cancel')),
              h('button', { className: 'basr-btn', disabled: !delable, onClick: rebuildDoc }, t('rebuild')),
              h('button', { className: 'basr-btn', disabled: doctorBusy, onClick: runDoctor }, doctorBusy ? t('doctorBusy') : t('doctor')),
              h('div', { className: 'basr-menu-wrap' },
                h('button', {
                  className: 'basr-btn',
                  disabled: !delable,
                  onClick: () => { setMenuOpen(!menuOpen); setConfirming(''); },
                }, (menuOpen ? '▴ ' : '▾ ') + t('del')),
                menuOpen && delable ? h('div', { className: 'basr-menu' },
                  h('div', {
                    className: 'basr-menu-item' + (confirming === 'record' ? ' danger' : ''),
                    onClick: () => { if (confirming === 'record') delJob(false); else setConfirming('record'); },
                  }, confirming === 'record' ? '再点一次确认' : '只删记录（保留产物）'),
                  h('div', {
                    className: 'basr-menu-item danger',
                    onClick: () => { if (confirming === 'files') delJob(true); else setConfirming('files'); },
                  }, confirming === 'files' ? '再点一次确认' : '连产物一起删除'),
                  h('div', { className: 'basr-menu-tip' }, '产物 = works/<BV>/，删了不可恢复')
                ) : null,
                menuOpen ? h('div', { className: 'basr-menu-backdrop', onClick: () => { setMenuOpen(false); setConfirming(''); } }) : null
              )
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

      // 入口挂在「设置」里（与 dsh-bili-scroll 一致）：slots 取法两种都试，取不到就放弃注册
      const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots;
      if (!slots) return;
      try {
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: PANEL_ID, order: 40, label: label() },
          () => h(BiliAsrPanel, { ctx, t }),
        ));
      } catch (err) {
        console.error('[dsh-bili-asr] settings.section registration failed', err);
      }
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
