# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Per-part selection in the panel (`--pages` equivalent)
- Optional smaller Whisper model (`tiny`/`base`) for faster CPU runs
- `bili_asr_doctor` environment self-check
- Global audio cache keyed by cid
- Export SRT / VTT

## [0.6.0] - 2026-11-12

### Added
- **环境自检**：`bili_asr_doctor` 工具 / `POST /api/bili-asr/doctor` / 面板「环境自检」按钮，逐项检查 Python、faster-whisper/av/Pillow、模型文件、数据目录可写、磁盘空间、B站接口，失败项带修复建议。
- **SRT / VTT 导出**：`--srt` / `bili_asr_run({ srt: true })` / 面板「导出字幕」，写到 `subtitles/`（每 cid 一份；多分P额外合并一份 `<BV>.srt`）。
- **重建文档**：`--rebuild` / `bili_asr_rebuild` / `POST /api/bili-asr/rebuild` / 面板「重建文档」，只读 `transcripts/` + `graph.json` + `meta.json` 重出 `script.md`，不联网、不重跑 ASR（实测 0 秒）。
- 每次运行写 `meta.json`（标题、分P、graph_version），供重建使用。

## [0.5.0] - 2026-11-12

### Added
- **删除**：`bili_asr_delete` 工具 / `POST /api/bili-asr/delete` / 面板「删除 ▾」展开栏（只删记录 / 连产物一起删，两步确认）；运行中/排队中的任务必须先取消。`bili_asr_run` 的返回值补上 `bv`。
- **互动视频节点截图**（`--frames` / `bili_asr_run({ frames: true })` / 面板勾选「节点截图」）：每个分P或剧情节点用 Range 只取视频开头 ~1.2 MB，PyAV 解出一帧存成 `frames/<cid>.jpg`，文档里自动生成「节点截图」一节（`![]` 相对路径）。
- 依赖新增 Pillow（`frames.py` 存 JPEG 用）；setup 时一并安装。
- 截图支持 `--at <秒>`（默认 1 秒），并默认**避开黑帧**：从目标时间往后找第一帧亮度 ≥ 18/255 的画面，找不到就取该段最亮的一帧（日志里有 `t=` 与 `fallback=`）。

### Changed
- 入口从侧栏底部挪进「设置 → B站转写」。
- 面板布局重排：按钮不再换行、路径单独省略、列表/文档区 grid 分栏且各自限高滚动。

### Fixed
- 静音节点上 Whisper 会把 `initial_prompt` 原样吐成台词（「请用简体中文转写。」），以前被当成正文写进文档；现在转写层与文档层都会过滤掉这种回声。


## [0.4.0] - 2026-11-11

### Added
- `bili_asr_cancel` 工具 + `POST /api/bili-asr/cancel`：排队中的直接出队；运行中的杀掉整棵进程树（node → python），已下载音轨与已转写片段保留。
- **平台字幕优先**：每个分 P / 剧情节点先查 `/x/player/v2`，有字幕轨就直接取正文字幕，不再下音轨、不跑 ASR；匿名拿不到字幕时保持原样回落本地转写。文档会标注每段文字来源（平台字幕 N 段 / 本地 ASR M 段）。
- 面板工具条加「取消任务」按钮（仅对运行中/排队中的任务可用）。
- **入口移到设置页**：不再占侧栏底部，改为 `settings.section`（设置 → B站转写）。
- 状态输出带上 `canceledAt`；`bili_asr_doc` 对被取消的任务给出说明而不是报错。
- **失败可诊断**：所有失败都带 `code` + `message` + `hint`（如 `SETUP_REQUIRED` / `RATE_LIMITED` / `AUDIO_FAILED`），`bili_asr_status` 和面板直接显示「怎么办」；文档接口把错误当正文返回。

### Fixed
- `dataDir` 还不存在时 spawn 子进程会 `ENOENT`（首次安装、还没跑 setup 就会撞上），现在先建目录。

## [0.3.1] - 2026-11-11

### Fixed
- cordis.patch.yml 不再写死本机数据目录：别人装下来会落到默认的 $DSH_HOME/bili-asr，不再指向不存在的盘符。
- docs/PUBLISH.md 去掉本机绝对路径，换成仓库相对写法。

## [0.3.0] - 2026-11-11

### Added
- **Client half**: sidebar entry plus a "Bili ASR" panel (start job, list jobs with progress, read `script.md`, copy path).
- **Host HTTP API** under `/api/bili-asr/*`: `jobs`, `job`, `doc`, `run`, `setup` — guarded by the DSH trust fence (`connection.requestRejection`) and a same-origin check.
- `bili_asr_setup` tool / `bin/setup.mjs`: creates the venv, installs `faster-whisper==1.2.1` and downloads the model with sha256 verification and resumable downloads.
- **Serial job queue**: one transcription at a time; later jobs report `queued` with their position.
- Progress reporting per stage: graph crawl, audio download, transcription `i/n`, document build.
- `--out` option so the CLI can write into the current workspace (needed under DSH's `workspace-write` sandbox).
- English README, issue templates, changelog, `.gitignore`.

### Changed
- Paths are now driven by `BILI_ASR_HOME` / plugin `dataDir` instead of a hard-coded drive path.
- Interactive node titles that are pure numbers are rendered as `节点 N` instead of looking broken.
- ASR passes a Simplified-Chinese `initial_prompt` to reduce Traditional output drift.

### Fixed
- Elapsed time for finished/interrupted jobs no longer keeps increasing.
- Jobs left in `running`/`queued` state after a client restart are marked `interrupted` instead of hanging forever.
- Documents built when only cached transcripts exist now keep their node labels and counts correct.

## [0.2.0] - 2026-11-11

### Added
- Client half skeleton and HTTP routes.
- Job persistence to `works/jobs.json` so the panel survives restarts.

## [0.1.0] - 2026-11-11

### Added
- Initial host-only plugin wrapping the local `bili-asr` CLI: `bili_asr_run` / `bili_asr_status` / `bili_asr_doc`.
- Interactive-video support: fetch `graph_version` from `/x/player/v2`, walk `/x/stein/edgeinfo_v2`, emit `graph.json` + `tree.md` + `script.md`.
