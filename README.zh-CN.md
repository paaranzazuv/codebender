[English](README.md) | [Español](README.es.md) | [简体中文](README.zh-CN.md)

> **0.7.5 行为：** **Review Changes** 树现在提供 `✓ 接受该文件的所有更改` 和 `↶ 拒绝该文件的所有更改` 两个可选的文件级批量快捷操作。内联审查仍严格按变更块（hunk）执行。

> **0.7.4 行为：** 保留 0.7.3 的“仅新更改”审查门控，并修复 **请求修正**，使所选代码块的反馈作为一条完整终端消息发送给编码代理。


> **0.7.2 修复：** 当 Git 与工作区使用不同换行符时，仅打开文件不会再产生“整个文件已更改”的误报；接受、拒绝和 Stage 仍严格按代码块执行。

# CodeBender

**面向 AI 编程代理的人机协同代码审查工具——直接运行在 VS Code 中。**

CodeBender 会把 AI 编程代理产生的代码修改转换为原始源文件中的可审查内联变更块。你可以逐块接受或拒绝修改，可选择将已接受代码加入 Git 暂存区，把某个变更块连同反馈发回代理，在待审变更之间导航，并使用 Git 保留轻量级审查历史。

> CodeBender 与模型供应商无关。它可以配合 Claude Code、Codex、Kimi Code、Gemini CLI、OpenCode、VS Code 当前集成终端或自定义 CLI 适配器使用。

## CodeBender 解决什么问题

AI 编程代理可以在很短时间内修改大量文件。CodeBender 在这些修改与代码库最终状态之间增加了一层人工审批。

```text
AI 编程代理
      ↓
修改 workspace 文件
      ↓
CodeBender 检测变更块
      ↓
┌────────────────────────────────────────────┐
│  AI: Claude Code · 块 2/5                 │
│                                            │
│  ✓ 接受       ⎇ 接受 + Stage             │
│  ↶ 拒绝       💬 请求修正                  │
│                                            │
│  已修改代码                                │
└────────────────────────────────────────────┘
      ↓
人工决策
      ↓
Git / 代理反馈循环
```

目标是在保持供应商中立的同时，通过 VS Code 公开扩展 API 提供接近现代 AI 编程助手的逐块审查体验。

---

## CodeBender 0.7.2 新特性

0.7.2 保留 0.7.0 的 Git-first 快速启动，同时把审查模型恢复为 **严格的逐块决策**。

### 逐块审查与可选的文件批量快捷操作

内联审查仍严格按 hunk 执行。打开源文件后可以直接对每个 hunk 操作：

- **接受** — 仅接受当前选中的块。
- **接受 + Stage** — 仅接受并暂存当前选中的块。
- **拒绝** — 仅恢复当前选中的块。
- **请求修正** — 仅把当前块发送回配置的代理。

在 **Review Changes** 树中，CodeBender 还为普通文件提供两个明确的批量快捷操作：**接受该文件的所有更改** 和 **拒绝该文件的所有更改**。无需打开文件即可一次处理该文件中所有待审查块；这不会改变内联控件逐块处理的行为。

如果文件被完全删除，由于已经没有源文档可渲染 CodeLens，该删除会被视为一个删除块，并在树中提供对应的块级操作。

### 修复 Accept + Stage

0.7.0 的快速 baseline 在会话开始前已有本地工作时，可能与真实 Git index 不同。旧的安全检查因此会过度拒绝部分暂存。

0.7.2 会把选中的审查 hunk 应用到 **当前 Git index 内容**，而不是用完整审查 baseline 覆盖 staged 文件。这样可以保留不相关的 staged 修改，也不会把会话开始前的 unstaged 工作一起加入 staging。如果选中块与已有修改发生不兼容重叠，CodeBender 会在写入 index 前安全中止。

### 自动化回归测试

源码包现在包含 Node 测试，覆盖独立 hunks、Accept + Stage、会话前 staged/unstaged 修改、插入、删除以及安全冲突处理。

---

## CodeBender 0.7.0 新特性

0.7.0 重点改进 **启动性能、Git-first 版本管理以及 snapshot 可靠性**。

### Git-first 延迟 baseline

在 Git workspace 中，开始审查会话时，CodeBender 不再需要把整个项目复制到 VS Code global storage。

#### 干净仓库

CodeBender 可以直接复用当前 `HEAD` 作为审查 baseline。

```text
开始审查会话
        ↓
检测到 Git 仓库
        ↓
working tree 干净
        ↓
HEAD 成为 baseline
        ↓
就绪
```

无需对整个项目做物理备份。

#### 已存在本地未提交修改

如果开始会话前已经有未提交工作，CodeBender 会使用 **隔离的临时 Git index** 和内部 checkpoint 精确保留起始状态。

```text
HEAD
 +
会话开始前的本地修改
        ↓
临时 Git index
        ↓
CodeBender baseline checkpoint
```

创建该 checkpoint 不会占用或覆盖真实 Git staging area。

#### 延迟加载文件内容

只有当某个文件真正参与审查决策时，CodeBender 才读取它的原始内容。

例如，一个仓库有 10,000 个文件，而代理只修改了 4 个文件，CodeBender 不需要预先读取和复制全部 10,000 个文件。

```text
10,000 文件的 Git 仓库
        ↓
Git baseline
        ↓
代理修改 auth.ts
        ↓
仅加载 auth.ts 的 baseline
        ↓
计算审查块
```

### 更快刷新

对于 Git 管理的根目录，CodeBender 会优先向 Git 查询变更路径，而不是反复扫描并哈希整个 workspace。

### 更可靠的 snapshot fallback

未被 Git 管理的目录仍使用文件 snapshot 引擎。0.7.0 中：

- 在并发 worker 启动之前先创建 snapshot 存储目录；
- `snapshots` 和 `undo` 目录只初始化一次；
- 常见依赖和构建目录默认继续排除；
- 避免此前可能出现的 `ENOENT ... globalStorage/.../snapshots/...` 启动竞态问题。

### 更少的自动 Git 工作

`codeBender.git.checkpointOnDecision` 默认值现在为 `false`。

因此，每次接受或拒绝单个变更块时，不会自动再创建一个 Git checkpoint，除非你主动开启该行为。

---

## 核心功能

### 文件内逐块审查

同一源文件中的独立修改会保持为独立的审查决策。

每个待处理 hunk 都可以在修改代码上方显示 CodeLens 操作，并在编辑器 gutter 中显示标记。

- **接受** — 仅将该块保留为新的审查 baseline。
- **接受 + Stage** — 接受该块，并在 Git 安全检查通过后把已接受状态安全加入暂存区。
- **拒绝** — 只把该块恢复到 baseline 状态。
- **请求修正** — 为该块生成上下文，并把你的反馈发送到选定的编程代理终端。

示例：

```text
文件: src/auth.ts

✓ 接受   ⎇ 接受 + Stage   ↶ 拒绝   💬 请求修正
────────────────────────────────────────────────
块 1
修改后的身份验证逻辑

...

✓ 接受   ⎇ 接受 + Stage   ↶ 拒绝   💬 请求修正
────────────────────────────────────────────────
块 2
修改后的校验逻辑
```

处理块 1 不会自动处理块 2。

### Gutter 标记

待审内联变更会在编辑器左侧 gutter 标记，因此无需打开传统的整文件 diff 就能看到仍需人工处理的位置。

### Explorer 徽标

包含待审变更的文件可以在 VS Code Explorer 中显示徽标。

关闭方式：

```json
{
  "codeBender.explorer.badges": false
}
```

### 变更导航

默认快捷键：

| 操作 | Windows / Linux | macOS |
|---|---|---|
| 下一个待审变更 | `Alt+Shift+Down` | `Alt+Shift+Down` |
| 上一个待审变更 | `Alt+Shift+Up` | `Alt+Shift+Up` |
| 撤销上一次决策 | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

### 撤销审查决策

**CodeBender: Undo Last Decision** 可以恢复前一个 CodeBender 审查状态。

对于 `接受 + Stage`，CodeBender 还会记录足够的 Git index 状态，以便在可能时恢复原来的 index entry。

---

## Git 集成与版本管理

CodeBender 使用 Git 有两个不同目的：

1. **审查 baseline / checkpoints** — 内部版本管理，不应移动当前分支或 `HEAD`。
2. **接受 + Stage** — 显式操作，会有意更新真实 Git index 中已接受的状态。

### 内部 checkpoints

CodeBender checkpoint 可保存在类似以下内部引用下：

```text
refs/codebender/<session>/checkpoints/00001
```

创建 checkpoint 不需要切换分支。

### 临时 Git index

创建 checkpoint 使用临时 `GIT_INDEX_FILE`，因此不会为了捕获 CodeBender baseline 而替换用户正常的 staging 状态。

```text
你的正常 index
      │
      └── 创建 checkpoint 时保持不变

CodeBender
      │
      └── 临时 index → tree → 内部 checkpoint
```

### 接受 + Stage 的安全保护

`接受 + Stage` 会有意修改真实 Git index。

执行前，CodeBender 会检查该文件现有 index 状态是否与预期的审查 baseline 一致。如果存在歧义，操作会被拒绝，而不是静默覆盖与 CodeBender 无关的既有 staged 工作。

### Git Timeline

Git 相关视图可以展示：

- 当前分支；
- staged / modified / untracked 数量；
- 最近的普通 Git commits；
- CodeBender 内部 checkpoints。

### 推荐 Git 工作流

```text
开始审查会话
        ↓
代理修改代码
        ↓
逐块内联审查
        ├── 接受
        ├── 接受 + Stage
        ├── 拒绝
        └── 请求修正
        ↓
处理所有预期变更块
        ↓
运行 tests / build
        ↓
使用正常 Git 流程 commit
        ↓
需要时再 push
```

CodeBender 不需要自动执行 `push`。

---

## 代理反馈循环

CodeBender 可以把选中的审查块连同人工反馈重新发送给编程代理。

生成的上下文可以包含：

- workspace 和文件路径；
- 修改行范围；
- 原始代码块；
- 当前代码块；
- 审查者备注；
- 可选的附近上下文或整个文件上下文。

默认情况下，CodeBender 会把生成的 prompt 插入所选集成终端，**但不会自动按 Enter**。

这样在代理真正收到指令之前，控制权仍在用户手中。

### 内置代理适配器

- Claude Code
- Codex
- Kimi Code
- Gemini CLI
- OpenCode
- 当前集成终端

### 自定义 CLI 适配器

可通过 `settings.json` 添加：

```json
{
  "codeBender.agent.adapters": [
    {
      "id": "my-agent",
      "label": "My Agent",
      "command": "my-agent-cli",
      "matchers": ["my agent", "my-agent"]
    }
  ]
}
```

CodeBender 本身不需要 Anthropic、OpenAI、Moonshot、Google 或其他 AI 提供商的 API key。

---

## 变更归属

CodeBender 支持 best-effort 方式标记审查块的来源，例如：

- **Manual**
- 当前选择的编程代理
- **Mixed**，当重叠修改与多个来源有关时

使用 **CodeBender: Select Change Source** 指定接下来由谁产生修改。

把反馈发送给某个代理后，也可以自动把该代理设为当前来源。

> VS Code 不提供可密码学验证的信号来精确证明哪个外部进程写入了每个字符。因此，该归属仅为 best-effort，不应被当作审计级作者身份凭证。

---

## 暂停与恢复跟踪

当你需要进行不应自动形成新审查块的手动修改时，可以暂停 CodeBender。

恢复跟踪时，暂停期间的修改可以根据配置的冲突策略并入 baseline。

可用策略：

- `ask`
- `keep-pending`
- `absorb-all`

---

## 审查会话

**Review Sessions** 视图保存轻量级会话摘要，例如：

- 已接受决策；
- 已拒绝决策；
- staged 决策；
- 已发送反馈；
- undo 操作；
- 会话结束时仍待处理的文件。

活动会话会被持久化，因此 VS Code 重启后 CodeBender 可以恢复审查状态。

---

## 安装

### 安装打包好的 VSIX

1. 下载 `codebender-0.7.2.vsix`。
2. 打开 VS Code。
3. 按 `Ctrl+Shift+P`。
4. 运行 **Extensions: Install from VSIX...**。
5. 选择 `codebender-0.7.2.vsix`。
6. 如果 VS Code 提示，运行 **Developer: Reload Window**。

使用 VS Code CLI：

```bash
code --install-extension codebender-0.7.2.vsix
```

### 从旧版本升级

直接在现有扩展之上安装新 VSIX，然后重新加载 VS Code。

在重要仓库中测试开发版本之前，仍建议先创建正常 Git commit 或独立备份。

### 从源码运行

```bash
git clone <your-codebender-repository>
cd codebender
npm run check
code .
```

然后按 `F5` 启动 Extension Development Host。

0.7.2 源码包包含扩展源码、验证脚本以及自动化 Node 回归测试。运行 `npm test` 即可执行。

---

## 快速开始

1. 在 VS Code 中打开项目文件夹。
2. 打开 Activity Bar 中的 **CodeBender** 视图。
3. 点击 **Start Review Session**。
4. 如果 Git 可用并且 `codeBender.git.fastBaseline` 已启用，CodeBender 会初始化 Git-first baseline。
5. 让 Claude Code 或其他编程代理修改 workspace。
6. 打开一个已修改源文件。
7. 使用 **接受**、**接受 + Stage**、**拒绝** 或 **请求修正** 审查内联块。
8. 从编辑器或 CodeBender 视图导航剩余变更。
9. 所有预期变更处理完后结束审查会话。
10. 适当时使用你的正常 Git 流程提交代码。

---

## 与 Claude Code 搭配的推荐流程

```text
打开 Git 仓库
        ↓
开始 CodeBender 审查会话
        ↓
选择来源: Claude Code
        ↓
Claude 修改文件
        ↓
CodeBender 标记内联变更块
        ↓
┌───────────────────────────────┐
│ ✓ 接受                        │
│ ⎇ 接受 + Stage               │
│ ↶ 拒绝                        │
│ 💬 请求修正                   │
└───────────────────────────────┘
        ↓
Claude 可继续修正被拒绝的块
        ↓
审查剩余块
        ↓
tests / build
        ↓
Git commit
```

---

## 设置

| 设置 | 默认值 | 用途 |
|---|---:|---|
| `codeBender.excludeGlob` | 生成/依赖目录 | snapshot fallback 和会话扫描排除路径 |
| `codeBender.maxFileSizeMB` | `10` | 备份/恢复可处理的最大文件大小 |
| `codeBender.maxFiles` | `20000` | 单个会话最多考虑的文件数 |
| `codeBender.confirmReject` | `true` | 对整文件或全部拒绝操作进行确认 |
| `codeBender.inlineReview.enabled` | `true` | 启用内联逐块审查 |
| `codeBender.inlineReview.showCodeLens` | `true` | 在 hunks 上方显示审查操作 |
| `codeBender.inlineReview.maxLines` | `25000` | 内联 diff 行数上限 |
| `codeBender.explorer.badges` | `true` | 显示 Explorer 待审徽标 |
| `codeBender.git.enabled` | `true` | 启用 Git checkpoints 和 staging 集成 |
| `codeBender.git.fastBaseline` | `true` | 可用时使用 Git-first 延迟 baseline |
| `codeBender.git.checkpointOnDecision` | `false` | 每次审查决策后创建 Git checkpoint |
| `codeBender.git.maxCheckpoints` | `100` | 单会话显示的最大 checkpoints 数 |
| `codeBender.git.historyLimit` | `20` | 显示的最近 Git commits 数 |
| `codeBender.pause.conflictStrategy` | `ask` | 处理暂停跟踪期间的修改 |
| `codeBender.agent.default` | `ask` | 默认代理/适配器 |
| `codeBender.agent.autoCreateTerminal` | `false` | 缺少代理终端时自动创建 |
| `codeBender.agent.executePrompt` | `false` | 插入反馈后自动按 Enter |
| `codeBender.agent.contextMode` | `block+context` | 反馈上下文：块、附近上下文或文件 |
| `codeBender.agent.contextLines` | `40` | 附近上下文行数 |
| `codeBender.agent.maxFragmentChars` | `12000` | 发送给代理的最大片段长度 |

### 推荐性能配置

对于普通 Git 仓库：

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true,
  "codeBender.git.checkpointOnDecision": false,
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

---

## 性能模型

### Git 仓库

0.7.0 推荐路径：

```text
开始会话
   ↓
检测 Git
   ↓
解析 baseline
   ↓
监听相关变更
   ↓
按实际变化文件延迟加载 baseline 内容
```

这样可以避免旧流程中预先读取、哈希并物理复制整个 Git 仓库。

### 非 Git 目录

fallback 路径：

```text
开始会话
   ↓
安全创建 snapshot 存储目录
   ↓
扫描允许的文件
   ↓
保存 baseline snapshots
   ↓
监听变更
```

非 Git 项目中，为获得最佳性能，应继续排除依赖目录和构建产物。

---

## 隐私与安全

CodeBender 采用 local-first 设计：

- 不需要 CodeBender 后端；
- 扩展本身不实现 CodeBender 遥测服务；
- CodeBender 本身不需要 AI API key；
- Git-first baseline 通过本地 Git 对象和内部 refs 保存；
- 非 Git 或未覆盖目录使用文件 snapshots 作为 fallback；
- 代理反馈仅发送到所选集成终端或已配置 CLI 适配器；
- checkpoint 使用临时 Git index，而不是替换用户正常 index。

编程代理本身可能具有自己的网络、遥测、数据保留和隐私策略。CodeBender 不会改变 Claude Code、Codex、Kimi Code、Gemini CLI、OpenCode 或自定义工具自身的隐私保证。

---

## 安全模型

### 正常审查无需破坏性 Git 命令

正常逐块审查不依赖以下广泛破坏性操作：

```text
git reset --hard
git clean -fd
git checkout .
```

### 已有 staged 工作

checkpoint 使用隔离 index。`接受 + Stage` 不同：它会显式操作真实 Git index，因此 CodeBender 会在 staging 前检查 baseline 兼容性。

### 仍建议独立备份

CodeBender 仍处于早期阶段。Git 应继续作为主要版本控制系统；测试开发版本前，重要工作应正常 commit 或独立备份。

---

## 故障排除

### 会话启动曾出现 `ENOENT ... /snapshots/*.bin`

0.7.0 的 snapshot fallback 会在并发 snapshot 工作开始前初始化存储目录。对于 Git 仓库，快速 baseline 也会在正常路径中避免创建完整项目 snapshot。

升级后：

1. 安装 `codebender-0.7.2.vsix`。
2. 运行 **Developer: Reload Window**。
3. 打开 Git 管理的项目。
4. 开始新的审查会话。
5. 保持 `codeBender.git.fastBaseline` 开启。

### 启动仍然很慢

确认当前 workspace 确实位于 Git 仓库内。

Git 仓库推荐：

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true
}
```

非 Git 目录请检查 `codeBender.excludeGlob`，避免 snapshot 依赖与构建目录。

### 不显示内联控制

确认：

```json
{
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

保存已修改文件，如有需要运行 **CodeBender: Refresh Changes**。

### 删除文件没有内联按钮

已删除文件不存在当前编辑器文档，因此无法显示内联装饰。仍可从 CodeBender 侧边视图处理这些文件。

### `接受 + Stage` 被拒绝

当现有 Git index 与审查 baseline 不一致时，这是预期行为。安全检查用于避免覆盖不明确的既有 staged 工作。

---

## 已知限制

- GitHub Copilot 内部使用的私有内联 UI 并不是 VS Code 对第三方扩展公开的可复用组件。CodeBender 使用 CodeLens、编辑器装饰、gutter 图标、Tree Views、文件装饰、终端和 Git 等公开 API 复现相同审查思路。
- 变更归属是 best-effort，不具备密码学可靠性。
- 二进制文件或超过配置限制的文件可能只能按文件级处理，而不能按行/hunk 处理。
- 删除文件由于文档已不存在，无法显示内联控制。
- `接受 + Stage` 会有意拒绝不明确的 index 状态。
- multi-root workspace 可以同时使用 Git-backed 与 snapshot-backed 根目录。

---

## 架构

```text
VS Code Extension Host
│
├── 会话 / baseline 引擎
│   ├── Git-first 延迟 baseline
│   ├── 非 Git snapshot fallback
│   ├── baseline 内容缓存
│   ├── hunk 引擎
│   └── 暂停 / 恢复
│
├── 内联审查 UX
│   ├── CodeLens 操作
│   ├── gutter 标记
│   ├── 行装饰
│   ├── Explorer 徽标
│   ├── Review Changes
│   └── Review Sessions
│
├── Git 集成
│   ├── 临时 index checkpoints
│   ├── 内部 refs
│   ├── Git Timeline
│   ├── 安全部分 staging
│   └── 决策回滚
│
└── 代理适配器
    ├── Claude Code
    ├── Codex
    ├── Kimi Code
    ├── Gemini CLI
    ├── OpenCode
    ├── 当前终端
    └── 自定义 CLI
```

CodeBender 运行时没有 npm dependencies。

---

## 开发

使用以下命令验证 JavaScript 语法：

```bash
npm run check
```

当前 0.7.2 源码包包含针对 hunk 独立性和 Git 部分暂存的自动化 Node 回归测试。运行 `npm test` 即可执行。

推荐开发流程：

```bash
npm run check
code .
```

然后按 `F5` 启动 Extension Development Host，并在一次性 Git 测试仓库中测试审查流程。

---

## 项目状态

CodeBender 是一个早期 open-source 项目。0.7.2 面向主动测试和持续迭代。在评估开发版本时，请继续使用普通 Git commits 或其他独立备份保护重要工作。

## Roadmap

- 更丰富的内联反馈线程；
- 在 VS Code 公开 API 能力范围内进一步接近 Copilot 的交互；
- 在支持的场景下改进代理 turn 自动检测；
- 更快的非 Git snapshot fallback；
- 更稳健的 multi-root 会话 UX；
- 将 tests/build 验证绑定到已接受变更块；
- 根据已接受审查历史生成 commit message；
- 会话级接受/拒绝变更报告；
- 可选 MCP 适配层；
- 更语言感知的上下文提取；
- Marketplace 打包和 release 自动化。

## 贡献

欢迎 Issues 和 Pull Requests。参见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 许可证

MIT。参见 [`LICENSE`](LICENSE)。

## 商标 / 关联声明

CodeBender 是独立的 open-source 项目，与 GitHub、Microsoft、Anthropic、OpenAI、Moonshot AI、Google 或 OpenCode 无隶属关系，也未获得这些公司的官方背书。
