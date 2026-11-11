# dsh-bili-asr

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的 B 站视频转文字插件：
**匿名取音轨 → 本地 Whisper 转写**，不需要登录 B 站、不需要字幕轨。

- **普通视频 / 分P** → 逐段台词（带起止时间）
- **互动视频**（`is_stein_gate=1`）→ 抓 B 站 stein 剧情图，输出**分支树 + 每个节点的台词 + 结局台词**
- **两端**：会话里可以调工具；侧栏有「B站转写」面板，能起任务、看进度、读文档

## 为什么需要它

B 站绝大多数视频没有字幕轨（`/x/player/v2` 返回 0 条字幕），互动视频更是由几十个 7~25 秒的节点拼成的树，没有"正片"。
常见做法要么要求登录拿 AI 字幕，要么只拿到标题和简介。这个插件走另一条路：**下载音轨，本地转写**。

## 安装

```bash
# 1) 装插件（桌面版也可在「插件 → 添加插件」里输入 dsh-bili-asr）
dsh plugin --profile desktop add dsh-bili-asr
```

重启 DSH 后，让 agent 调一次 `bili_asr_setup`（或在侧栏面板点「装环境」）。它会：

1. 建一个独立 Python venv（优先用 `uv`，没有就用 `python -m venv`）
2. 装 `faster-whisper==1.2.1`（默认走清华 PyPI 镜像）
3. 下载 `Systran/faster-whisper-small` 的 4 个模型文件（约 486 MB，**逐个校验 sha256**）

默认数据目录 `$DSH_HOME/bili-asr`（通常是 `~/.dsh/bili-asr`），里面是 `venv/`、`model/`、`works/`。
国内网络默认从 `hf-mirror.com` 下模型（`huggingface.co` 直连常常超时）；可换源：

```js
bili_asr_setup({ pipIndex: "https://pypi.tuna.tsinghua.edu.cn/simple", hfEndpoint: "https://hf-mirror.com" })
```

## 用法

### 会话里（工具）

| 工具 | 说明 |
|---|---|
| `bili_asr_run({ video, pages?, noAsr? })` | 起一个转写任务，立即返回 `taskId` |
| `bili_asr_status({ id? })` | 查进度与最近日志；不传 id 列出最近任务 |
| `bili_asr_doc({ id, offset?, limit? })` | 分页读 `script.md`（`next` 非空时继续读） |
| `bili_asr_setup({ pipIndex?, hfEndpoint? })` | 一次性装环境 |

任务是异步的：`run` 立刻返回，别等它跑完。

### 命令行

```bash
node bin/setup.mjs                                   # 装环境
node bin/bili-asr.mjs BV1xxxxxxxxx                   # 普通视频
node bin/bili-asr.mjs BV159WJ63EMK                   # 互动视频（自动识别）
node bin/bili-asr.mjs BV1xxx --pages 1,3             # 只做指定分P
node bin/bili-asr.mjs BV1xxx --out ./somewhere       # 换个输出目录
```

产物（默认 `$DSH_HOME/bili-asr/works/<BV>/`）：

```
graph.json      互动视频的剧情图（节点/选择边/结局）
tree.md         纯结构树
script.md       分支 + 台词（普通视频是逐段台词）
audio/          节点音轨
transcripts/    逐段转写 JSON（带起止时间）
```

## 配置

在 profile 的插件 `config` 里改（改完重载）：

```yaml
- id: bili-asr
  name: dsh-bili-asr
  config:
    dataDir: /your/data/dir       # 默认 $DSH_HOME/bili-asr
    pythonPath: /path/to/python   # 可选，默认 dataDir/venv
    asrModelPath: /path/to/model  # 可选，默认 dataDir/model/faster-whisper-small
    pipIndex: https://pypi.tuna.tsinghua.edu.cn/simple
    hfEndpoint: https://hf-mirror.com
```

## 已知限制

- **任务串行执行**：ASR 会吃满 CPU，几个任务一起跑只会互相拖慢（实测：单独 4 分钟的任务，与另一个任务重叠时拖到 21 分钟）。后来的任务显示「排队中 · 第 N 位」。
- **只有音频**：画面、字幕样式、jumpscare 都拿不到；要看画面得自己抽帧。
- **ASR 有误字**：中文专名、同音字常错（例："纯金雕像"→"纯击在雕像"）。文档保留原文，不做润色。
- **静音幻觉**：模型在无语音片段可能吐出「字幕由…提供」之类的句子，文档层已按正则过滤。
- **互动视频节点通常没有字幕轨**，转写是唯一正文来源；节点数多时耗时随之增长（69 节点约 1 分钟）。
- **匿名接口有风控**：偶发 `412` 会直接停，不会硬刷；音轨走最低码率（30216），也受 CDN 防盗链限制（必须带 `Referer`）。
- **无登录、无账号写入**：不碰你的 B 站账号，不做评论/收藏/点赞。

## 实测数据（Windows 11 / Node 24.19 / 纯 CPU）

| 场景 | 结果 |
|---|---|
| 全新目录装环境（venv + 486 MB 模型） | **79 秒**，占用约 708 MB |
| 普通视频 157 秒 | 转写 **65 秒**（约 0.4× 音频长），757~802 字 |
| 互动视频 48 节点 / 724 秒音频 | 242 秒，3980 字，6 个结局 |
| 30 分钟音频的互动剧（31 分钟音轨） | 单独约 1000 秒；与另一任务重叠时 1289 秒 |

> 这些是本机数字，CPU 型号不同会差不少。任务已改成串行排队，实际耗时基本按「音频总长 × 0.4~0.6」估算。

## 踩过的坑（写进代码里了，改代码前先看一眼）

- **huggingface.co 直连超时**：模型默认走 `hf-mirror.com`；486 MB 的大文件必须支持断点续传（HTTP Range），否则一定断在半路。
- **faster-whisper 自带的 av 解码在 av 19 上会抛** `open() got an unexpected keyword argument 'metadata_errors'`：`transcribe.py` 自己用 `av.AudioResampler` 解码成 numpy 再喂模型。
- **互动视频的 `edge_id` 必须传 `choice.id`**，传 1、2、3 这类顺序值基本都返回 `-400`；节点视频 cid 在 `choice.cid`。
- **静音段会幻觉**出「字幕由…提供」这类句子：文档层按正则过滤，别当真台词。
- **匿名接口偶发 412**：直接停，不要循环重试，否则风控更久。
- **桌面版宿主里没有 `node`**：插件用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 起子进程，别直接 `spawn("node")`。
- **跨工作区写入**：DSH 沙箱只允许写当前工作区，命令行调用时用 `--out` 指到当前目录。
- **PowerShell 5.1 读无 BOM 的 .ps1 会按 ANSI 解析**：自己写 Windows 辅助脚本时存成 UTF-8 **带 BOM**。

## 开发

```bash
npm pack --dry-run              # 看发布内容（.github / CHANGELOG 只在仓库里，不进包）
node bin/setup.mjs              # 本地装环境
node bin/bili-asr.mjs BV1xxx    # 直接跑 CLI
```

仓库结构：`index.js`（宿主：工具 + HTTP）/ `client.js`（侧栏面板）/ `bin/`（CLI、转写、setup）/ `cordis.patch.yml`（挂载声明）。

## 致谢与许可

- 转写引擎 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)，模型 [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small)（MIT）。
- 宿主 API 用法参考了 [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll)（`defineTool` 兜底、`webServer` 路由 + 信任栅栏）与 [dsh-plugin-manager](https://github.com/DDTomTom/dsh-plugin-manager)（客户端 slots 契约）。
- 本项目 MIT，见 [LICENSE](LICENSE)。
