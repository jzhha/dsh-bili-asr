# dsh-bili-asr v0.3.0

把 B 站视频转成本地文字，**不用登录、不等字幕**。互动视频会抓 B 站 stein 剧情图，输出分支树 + 每个节点的台词 + 结局。

## 这一版有什么

- **侧栏面板**：起任务、看进度（`抓剧情树 0/48` → `下音轨 5/16` → `转写 12/16`）、读 `script.md`、复制产物路径
- **4 个工具**：`bili_asr_setup` / `bili_asr_run` / `bili_asr_status` / `bili_asr_doc`
- **一条命令装环境**：自动建 venv、装 faster-whisper、下 486 MB 模型（sha256 逐文件校验、断点续传、hf-mirror 兜底）
- **串行队列**：ASR 吃满 CPU，任务排队执行，不再互相拖慢
- **普通视频**逐分P转写；**互动视频**自动识别并抓树

## 安装

```bash
dsh plugin --profile desktop add dsh-bili-asr
```

重启后在会话里调一次 `bili_asr_setup`（或面板点「装环境」）。默认数据目录 `~/.dsh/bili-asr`。

国内网络：PyPI 默认清华镜像，模型默认 `hf-mirror.com`；都可在 `config` 里换。

## 已知问题

- 只有音频：画面、字幕样式拿不到
- ASR 有误字；静音段可能幻觉出「字幕由…提供」，已在文档层过滤
- 互动视频节点通常无字幕轨，转写是唯一正文来源
- 匿名接口偶发 `412`，会直接停、不硬刷
- 面板暂不支持取消任务、选分P（命令行 `--pages` 可以）

## 验证范围

- 在 Windows + DSH 0.2.1-rc.3 desktop profile 上实测：普通视频（157 秒 → 757 字）、互动视频（48 节点 / 6 结局 / 3980 字）
- 干净目录安装模拟：解包 → 全新数据目录 → `setup` → 转写，全流程通过
- 未验证：macOS / Linux 实机、无 `uv` 时的 `python -m venv` 分支、其他 DSH 版本

## 致谢

faster-whisper（SYSTRAN）、faster-whisper-small 模型（Systran，MIT）；
宿主 API 用法参考 dsh-bili-scroll 与 dsh-plugin-manager。MIT License。
