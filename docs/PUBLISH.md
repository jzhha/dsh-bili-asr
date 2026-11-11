# 发布清单（照这个顺序做）

> 目标：`github.com/<owner>/dsh-bili-asr` 公开仓库 + npm 包 + Release。
> 本机没有 `gh` CLI，以下命令要么手动在网页做，要么先装 gh。

## 0. 前置

```powershell
cd G:\DSH-DATA\plugin-src\dsh-bili-asr
git status              # 应看到 22 项已暂存
```

## 1. 建仓库（网页最快）

GitHub → New repository：

- 名称：`dsh-bili-asr`
- 可见性：Public
- **不要**勾选 README / .gitignore / License（本地已有）

然后：

```powershell
git remote add origin https://github.com/<owner>/dsh-bili-asr.git
git commit -m "feat: dsh-bili-asr 0.3.0"
git push -u origin main
```

## 2. 填仓库元信息

`package.json` 里已留好字段，确认 owner 后改这三处：

```json
"repository": { "type": "git", "url": "git+https://github.com/<owner>/dsh-bili-asr.git" },
"homepage": "https://github.com/<owner>/dsh-bili-asr#readme",
"bugs": { "url": "https://github.com/<owner>/dsh-bili-asr/issues" }
```

改完再提交一次（否则 npm 页面没有仓库链接）。

## 3. 打标签 + 发布

```powershell
git tag v0.3.0
git push --tags

# 方式 A：npm（需要 npm 账号 + 2FA）
npm publish

# 方式 B：只发 GitHub Release（不依赖 npm）
npm pack
# 把 dsh-bili-asr-0.3.0.tgz 拖进 Release 附件
# 正文直接用 RELEASE_NOTES.md
```

Release 页面：tag `v0.3.0`，标题 `dsh-bili-asr v0.3.0`，正文贴 `RELEASE_NOTES.md`，附件带 `.tgz`。

## 4. Project 看板

`docs/BACKLOG.md` 里 14 条按 P0/P1/P2 分好了。两种导入方式：

**手工**：Project 页面 → Add item → 粘贴标题；再逐条补描述与验收标准。

**批量（装了 gh 之后）**：

```powershell
gh auth login
Get-Content docs/BACKLOG.md | Select-String -Pattern '^### ' | ForEach-Object {
  $title = $_.Line -replace '^### \d+\.\s*', ''
  gh issue create --title $title --body "见 docs/BACKLOG.md 对应条目" --label backlog
}
```

> Project（v2）可以直接把仓库 issue 加进看板：Project → Add item → "Add item from repository"。

## 5. 发布后自检

- [ ] 仓库首页 README 正常渲染（中文为主，`README.en.md` 供英文用户）
- [ ] `.github/ISSUE_TEMPLATE` 生效：New issue 能看到两个模板
- [ ] Release 附件里的 tgz 能被 `dsh plugin --profile desktop add <直链>` 装上
- [ ] 在一个干净 profile 里跑一遍 `bili_asr_setup` + 一条视频
