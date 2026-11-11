修复 v0.3.0 的一个发布事故：**包里的 `cordis.patch.yml` 写死了本机数据目录** `G:/DSH-DATA/...`，别人装下来会指向不存在的盘符，`setup` 直接失败。

- 现在不写 `dataDir`，默认落到 `$DSH_HOME/bili-asr`（通常是 `~/.dsh/bili-asr`）
- 要换目录，在你 profile 的 `cordis.patch.yml` 里加一层 `- id: bili-asr` 覆盖即可
- 顺手去掉了 docs 里的本机绝对路径

```powershell
dsh plugin --profile desktop add https://github.com/jzhha/dsh-bili-asr/releases/download/v0.3.1/dsh-bili-asr-0.3.1.tgz
```
