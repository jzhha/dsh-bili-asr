# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Cancel a running job from the panel
- Per-part selection in the panel (`--pages` equivalent)
- Optional smaller Whisper model (`tiny`/`base`) for faster CPU runs

## [0.4.0] - 2026-11-11

### Added
- `bili_asr_cancel` 工具 + `POST /api/bili-asr/cancel`：排队中的直接出队；运行中的杀掉整棵进程树（node → python），已下载音轨与已转写片段保留。
- 面板工具条加「取消任务」按钮（仅对运行中/排队中的任务可用）。
- 状态输出带上 `canceledAt`；`bili_asr_doc` 对被取消的任务给出说明而不是报错。

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
