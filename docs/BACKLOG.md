# Backlog — usable as a GitHub Project board

每个条目都能直接变成一个 issue：`标题` + `标签` + `验收标准`。按优先级分三档，P0 是"发布前最好有"，P1 是"第一波迭代"，P2 是"想做但不急"。

## P0 — 发布前

### ~~1. 面板支持取消正在跑的任务~~（已在 0.4.0 完成）
- 实现：`bili_asr_cancel` 工具 + `POST /api/bili-asr/cancel`；运行中的用 `taskkill /T /F` 杀整棵进程树（实测 python 及其子进程一起退出），排队中的直接出队；状态写 `canceledAt`，面板工具条有「取消任务」按钮。

### 2. 无 `uv` 时的安装分支要真机验证
- **why**：README 承诺 uv 缺失时回落 `python -m venv`，但只在有 uv 的机器上跑过。
- **do**：干净容器/虚拟机（只有 Python 3.12）跑 `bin/setup.mjs`，记录耗时与坑。
- **AC**：无 uv 环境能装出可用 venv 并完成一次转写；把结果写进 README 的「实测数据」。

### 3. macOS / Linux 各跑一遍
- **why**：`bin/lib.mjs` 已按平台拼 venv 路径，但没在非 Windows 上验证过 spawn/路径/PyAV。
- **AC**：两平台各完成一次 `setup` + 普通视频转写；已知差异写进 README。

### ~~4. 失败信息可诊断~~（已在 0.4.0 完成）
- **why**：现在失败只给 exitCode；用户不知道是网络、412 还是模型没装。
- **do**：CLI 失败时输出结构化 `{stage:'error', code, hint}`；面板把 `hint` 直接显示。
- **AC**：断网、412、缺模型三种情况各给出一条可操作的提示。

## P1 — 第一波迭代

### 5. 面板里选分 P / 只转指定节点
- **why**：长视频只想看其中一段时，全量转写太浪费。
- **do**：面板加 parts 输入（逗号分隔）；映射到 `--pages`。互动视频支持按节点 id 子集。
- **AC**：输入 `1,3` 只产出 P1/P3 的台词，且 `script.md` 标注只覆盖这些部分。

### ~~6. 有字幕轨时直接用字幕，跳过 ASR~~（已在 0.4.0 完成）
- **why**：少数视频有 AI 字幕（A2），转写是多余的算力。
- **do**：读之前先查 `/x/player/v2` 的 `subtitle.subtitles`；有可用轨则直接取，`script.md` 标注来源 `subtitle`。
- **AC**：对有字幕视频，耗时从分钟级降到秒级，且文档标注"来源：平台字幕"。

### 7. 小模型选项
- **why**：CPU 慢的机器上 small 太慢；有些人只要"大概讲了什么"。
- **do**：`setup --model=small|base|tiny`，模型清单写进 `bin/models.json`（每档 sha256）。
- **AC**：`base` 档在同样视频上速度快约 2 倍，README 给出准确率/速度对比表。

### 8. 音频全局缓存
- **why**：现在每个 BV 目录各存一份音轨，重复转同一视频会重下。
- **do**：`<home>/cache/audio/<cid>.m4s`，按 cid 去重，works 里只留硬链接或不再复制。
- **AC**：同视频第二次 `run` 不发 playurl 请求；缓存可单独清理。

### 9. 导出 SRT / VTT
- **why**：`script.md` 给人看，做字幕要标准格式。
- **do**：`transcripts/*.json` 已有起止时间，加 `--srt` 产出；互动视频按节点分文件。
- **AC**：导出的 SRT 能被播放器识别，时间轴与 JSON 一致。

### 10. `bili_asr_doctor`：环境自检
- **why**：装不上时用户只能看日志；有人装到一半杀毒拦了 uv。
- **do**：检查 venv/python 版本、faster-whisper 能否 import、模型文件 sha256、`dataDir` 可写、B站 API 可达。
- **AC**：一条命令输出通过/失败清单，失败项带修复建议。

## P2 — 想做但不急

### 11. 互动视频节点截图
- **why**：只有台词，看不到画面；恐怖/视觉类互动剧信息损失大。
- **do**：抽帧依赖 + 图片模型能力检测，按节点出 1 张代表帧。
- **AC**：有图片能力时 `script.md` 里带图片引用；无能力时明确标注"未取得画面"。

### 12. CI：三平台矩阵 + 发布自动化
- **why**：目前全靠本机手测。
- **do**：GitHub Actions：node 22/24 × win/mac/linux 跑 `node --check` + 单测；打 tag 自动 `npm publish` + 生成 Release。
- **AC**：PR 必须过 CI；tag 推送后自动发布。

### 13. 繁体/简体质量评估
- **why**：`initial_prompt` 只压了一部分，输出仍夹杂繁体与同音错字。
- **do**：固定 3 条视频做基准，比较 `initial_prompt`、`language` 显式指定、后处理词典三种方案。
- **AC**：给出一张字错率对比表，选定默认方案写进 README。

### 14. 文档国际化
- **why**：面板已中英双语，README 也有英文版，但 docs 与 Release Notes 只有中文。
- **AC**：`RELEASE_NOTES.en.md`、`docs/` 关键篇目英文版齐备。
