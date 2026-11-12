# dsh-bili-asr

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that turns Bilibili videos into text — **anonymous audio fetch + local Whisper transcription**. No Bilibili login, no subtitle track required.

- **Regular videos / multi-part** → per-part transcript with timestamps
- **Interactive videos** (`is_stein_gate=1`) → walks Bilibili's *stein* story graph and produces **a branch tree with each node's lines and every ending**
- **Node stills** (`--frames`): one frame per part/node into `frames/`, embedded in the document
- **Subtitle tracks first**: every part/node probes `/x/player/v2`; when a track exists the subtitles are used directly and neither audio download nor ASR runs (anonymous requests rarely get one — set `BILI_SESSDATA` to supply a cookie)
- **Both halves**: agent tools in a session, plus a **Settings → "Bili ASR"** panel to start jobs, watch progress and read documents

## Why

Most Bilibili videos have no subtitle track at all (`/x/player/v2` returns zero subtitles), and interactive videos are not "one video" but a tree of 60+ short nodes (7–25 s each). The usual workarounds need a logged-in account for AI captions, or only get you the title and description. This plugin takes another route: **download the audio track and transcribe it locally**.

## Install

```bash
# Desktop app: Plugins → Add plugin → dsh-bili-asr works too
dsh plugin --profile desktop add dsh-bili-asr

# Without npm: install straight from the GitHub release
dsh plugin --profile desktop add https://github.com/jzhha/dsh-bili-asr/releases/download/v0.3.0/dsh-bili-asr-0.3.0.tgz
```

After restarting DSH, call `bili_asr_setup` once (or open **Settings → Bili ASR** and click **Setup**). It will:

1. create a dedicated Python venv (uses `uv` when available, otherwise `python -m venv`)
2. install `faster-whisper==1.2.1` (Tsinghua PyPI mirror by default)
3. download the four `Systran/faster-whisper-small` model files (~486 MB, **sha256 verified per file**)

Data lives in `$DSH_HOME/bili-asr` (usually `~/.dsh/bili-asr`): `venv/`, `model/`, `works/`.
Model downloads default to `hf-mirror.com` because `huggingface.co` frequently times out from mainland China. Override either mirror:

```js
bili_asr_setup({ pipIndex: "https://pypi.org/simple", hfEndpoint: "https://huggingface.co" })
```

## Usage

### In a session (tools)

| Tool | What it does |
|---|---|
| `bili_asr_run({ video, pages?, noAsr? })` | Start a transcription job, returns `taskId` immediately |
| `bili_asr_status({ id? })` | Progress + recent log lines; omit `id` to list recent jobs |
| `bili_asr_cancel({ id })` | Cancel a job: drops queued ones, kills the node → python process tree for running ones |
| `bili_asr_doc({ id, offset?, limit? })` | Page through `script.md` (follow `next` while non-null) |
| `bili_asr_setup({ pipIndex?, hfEndpoint? })` | One-time environment setup |

Jobs are asynchronous — `run` returns at once; poll `status`.

### Command line

```bash
node bin/setup.mjs                                   # set up the environment
node bin/bili-asr.mjs BV1xxxxxxxxx                   # regular video
node bin/bili-asr.mjs BV159WJ63EMK                   # interactive video (auto-detected)
node bin/bili-asr.mjs BV1xxx --pages 1,3             # only the given parts
node bin/bili-asr.mjs BV1xxx --out ./somewhere       # custom output directory
node bin/bili-asr.mjs BV159WJ63EMK --frames          # one still per node (~25 KB each)
```

Output (default `$DSH_HOME/bili-asr/works/<BV>/`):

```
graph.json      story graph for interactive videos (nodes / choices / endings)
tree.md         structure-only tree
script.md       branch tree + lines (per-part transcript for regular videos)
audio/          node audio tracks
transcripts/    per-segment JSON with timestamps
```

## Configuration

Edit the plugin `config` in your profile (reload afterwards):

```yaml
- id: bili-asr
  name: dsh-bili-asr
  config:
    dataDir: /your/data/dir       # default: $DSH_HOME/bili-asr
    pythonPath: /path/to/python   # optional, default: dataDir/venv
    asrModelPath: /path/to/model  # optional, default: dataDir/model/faster-whisper-small
    pipIndex: https://pypi.tuna.tsinghua.edu.cn/simple
    hfEndpoint: https://hf-mirror.com
```

## Known limitations

- **Audio only.** No frames, no subtitle styling, no jump scares — capture frames yourself if you need visuals.
- **ASR makes mistakes.** Chinese proper nouns and homophones are frequently wrong (e.g. "纯金雕像" → "纯击在雕像"). The document keeps the raw text; it is not polished.
- **Silence hallucinations.** On silent stretches Whisper may emit lines like "字幕由…提供"; the document layer filters them by regex.
- **Interactive nodes usually have no subtitle track**, so transcription is the only source of dialogue. More nodes = longer runtime.
- **Subtitle tracks are often unavailable anonymously** — set `BILI_SESSDATA` if you want subtitle-first to actually kick in.
- **Jobs run one at a time.** ASR saturates the CPU; running several concurrently only slows everything down (observed: a job that takes 4 minutes alone took 21 minutes when overlapped). Later jobs show "queued · position N".
- **Anonymous endpoints can be rate-limited.** An occasional `412` stops the job (no aggressive retries). Audio uses the lowest bitrate track (30216) and still needs a `Referer` header for the CDN.
- **No login, no account writes.** The plugin never touches your Bilibili account: no comments, favourites or likes.

## Measured on this machine (Windows 11 / Node 24.19 / CPU only)

| Scenario | Result |
|---|---|
| Fresh setup (venv + 486 MB model) | **79 s**, ~708 MB on disk |
| 157-second regular video | **65 s** transcription (~0.4× audio), 757–802 chars |
| 48-node interactive video / 724 s audio | 242 s, 3980 chars, 6 endings |
| 31-minute interactive audio | ~1000 s alone; 1289 s when overlapped with another job |

Numbers vary with your CPU. With the serial queue, estimate **audio length × 0.4–0.6**.

## When it fails

Every failure carries a `code`, a `message` and a `hint`; the panel and `bili_asr_status` show them directly.

| Code | Meaning | What to do |
|---|---|---|
| `SETUP_REQUIRED` | venv or model missing | run `bili_asr_setup` once |
| `RATE_LIMITED` | Bilibili rate limit (412) | wait 5–10 min; set `BILI_SESSDATA` or change network |
| `AUDIO_FAILED` | no audio track obtained | membership/region limit; try `--no-asr` for structure only |
| `VIDEO_NOT_FOUND` / `VIDEO_UNAVAILABLE` | video missing/private | check the link |
| `NO_PARTS` | nothing to process | pass `--pages` |
| `GRAPH_UNAVAILABLE` | interactive graph_version failed | run with `--no-asr`, file an issue with the BV |
| `TRANSCRIBE_FAILED` | python step failed | re-run setup, read the job log |

## Pitfalls (already handled in code — read before changing it)

- **`huggingface.co` times out from mainland China** — model downloads default to `hf-mirror.com`, and 486 MB transfers need resumable HTTP Range requests.
- **faster-whisper's bundled `av` decoder throws** `open() got an unexpected keyword argument 'metadata_errors'` on PyAV 19 — `transcribe.py` decodes with `av.AudioResampler` into numpy instead.
- **Interactive videos need `choice.id` as the `edge_id`** — sequential ids (1, 2, 3…) mostly return `-400`; the node's video cid lives in `choice.cid`.
- **Silence produces hallucinations** like "字幕由…提供" — filtered by regex at the document layer, never treated as dialogue.
- **Occasional `412`** — the job stops; retry loops only extend the rate limit.
- **No `node` in PATH inside the desktop host** — spawn `process.execPath` with `ELECTRON_RUN_AS_NODE=1`.
- **Writes are sandboxed per workspace** — when calling the CLI from another workspace, pass `--out` pointing into that workspace.
- **PowerShell 5.1 parses BOM-less `.ps1` as ANSI** — save helper scripts as UTF-8 **with** BOM.

## Acknowledgements & license

- Transcription by [faster-whisper](https://github.com/SYSTRAN/faster-whisper); model [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small) (MIT).
- Host API patterns borrowed from [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) (`defineTool` fallback, `webServer` routes + trust fence) and [dsh-plugin-manager](https://github.com/DDTomTom/dsh-plugin-manager) (client slot contract).
- MIT, see [LICENSE](LICENSE).
