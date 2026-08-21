<p align="center">
  <img src="media/icon.png" alt="CodeBender" width="112" />
</p>

<h1 align="center">CodeBender</h1>

<p align="center">
  <strong>面向 AI 编程代理的人机协同代码审查工具，直接运行在 VS Code 中。</strong>
</p>

<p align="center">
  将 AI 生成的修改以独立的内联变更块形式呈现。接受、拒绝、加入暂存区，或把某个变更块连同反馈发回代理，而不会失去对文件其余部分的控制。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?logo=visualstudiocode&logoColor=white" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.7.6-4C8BF5" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="Git-first" src="https://img.shields.io/badge/baseline-Git--first-F05032?logo=git&logoColor=white" />
  <img alt="Provider neutral" src="https://img.shields.io/badge/agents-provider--neutral-7B61FF" />
</p>

---

## 为什么选择 CodeBender

AI 编程代理修改代码库的速度可能超出人工能够舒适审查的范围。问题不在于生成代码本身，而在于**对最终保留下来的内容保持精确的人工控制**。

CodeBender 在 AI 代理与你的工作区之间加入了一层审查：

```text
AI 编程代理
      ↓
修改工作区文件
      ↓
CodeBender 只检测本次会话产生的新变更
      ↓
┌──────────────────────────────────────────────┐
│ 变更块 1                                     │
│ ✓ 接受   ⎇ 接受 + Stage   ↶ 拒绝            │
│ 💬 请求修正                                  │
└──────────────────────────────────────────────┘
      ↓
┌──────────────────────────────────────────────┐
│ 变更块 2                                     │
│ ✓ 接受   ⎇ 接受 + Stage   ↶ 拒绝            │
│ 💬 请求修正                                  │
└──────────────────────────────────────────────┘
      ↓
由人工掌控的最终结果
```

一个包含三处独立修改的文件，始终对应**三个独立的审查决策**。

CodeBender 的设计目标是贴近 AI 编程助手普及开来的逐块审查体验，同时保持**与供应商无关**，并构建在公开的 VS Code 扩展 API 之上。

---

## 核心亮点

### 逐块审查变更

每个新的变更块（hunk）都可以直接在源文件中审查：

- **接受** — 只保留所选的变更块。
- **接受 + Stage** — 接受并只将该变更块加入暂存区。
- **拒绝** — 只将该变更块还原为会话基线。
- **请求修正** — 只把该变更块、其上下文和你的说明发回所选的编码代理。

接受一个变更块不会自动接受文件中的其余部分。

### 无需打开文件的批量操作

**Review Changes** 视图还提供可选的文件级快捷操作：

```text
src/auth.ts                         ✓   ↶
src/api/users.ts                    ✓   ↶
src/components/Login.tsx            ✓   ↶
```

- `✓` **接受该文件的所有更改**
- `↶` **拒绝该文件的所有更改**

这些是明确的批量操作。内联审查依旧严格按变更块进行。

### Git-first 启动

对于 Git 仓库，CodeBender 会在会话开始前避免复制整个项目。

```text
启动审查会话
        ↓
检测到 Git 仓库
        ↓
工作区是否干净？── 是 ──→ 直接复用 HEAD 作为基线
        │
        否
        ↓
使用隔离的 Git 索引捕获精确的初始状态
        ↓
就绪
```

原始内容只针对与本次审查相关的文件按需惰性加载。

### 仅审查新变更

会话基线在你点击 **启动审查会话** 时被冻结。

打开、激活、切换到或仅仅查看某个文件**不会**产生审查操作。CodeBender 只标记会话开始之后出现的变更。

### 安全的部分暂存

`接受 + Stage` 只作用于所选的变更块，而不是把整个文件加入暂存区。当所选变更块可以被安全应用时，已有的暂存内容会被保留。

如果 CodeBender 检测到不安全的重叠，会在修改 Git 索引之前停止操作。

### 把变更块发回代理

`请求修正` 会发送一条结构化消息，包含：

- 你的说明放在最前面；
- 所选的文件与变更块；
- 修改后的代码；
- 最少量的周边上下文；
- 明确要求不要重写其他待审变更块的规则。

多行提示会以单条终端输入的形式发送，使用 bracketed paste 语义。

---

## 支持的编程代理

CodeBender 与供应商无关。内置的终端适配器支持：

| 代理 | 默认命令 |
|---|---|
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Kimi Code | `kimi` |
| Gemini CLI | `gemini` |
| OpenCode | `opencode` |
| 当前终端 | 已有的 VS Code 终端 |
| 自定义 CLI | 可配置适配器 |

使用这些集成无需 API key。CodeBender 通过你已经在用的本地终端工作流与代理通信。

---

## 安装

### 从 VSIX 安装

1. 下载 `codebender-0.7.6.vsix`。
2. 打开 VS Code。
3. 按下 `Ctrl+Shift+P` / `Cmd+Shift+P`。
4. 运行 **Extensions: Install from VSIX...**。
5. 选择下载的文件。
6. 如果 VS Code 没有自动重新加载，运行 **Developer: Reload Window**。

### 环境要求

- VS Code `1.85.0` 或更高版本。
- 强烈建议安装 Git，以启用快速基线、历史记录、检查点和部分暂存功能。
- 支持的本地编程代理 CLI 是可选的，仅 **请求修正** 功能需要。

---

## 快速开始

### 1. 打开一个项目

打开项目文件夹——而不仅仅是单个文件。

### 2. 启动一个审查会话

运行：

```text
CodeBender: Iniciar sesión de revisión
```

当前工作区状态会成为本次会话的基线。

### 3. 让编程代理开始工作

可以使用 Claude Code、Codex、Kimi、Gemini CLI、OpenCode、其他终端代理，或手动编辑。

### 4. 只审查新的变更块

在修改过的文件中：

```text
✓ 接受   ⎇ 接受 + Stage   ↶ 拒绝   💬 请求修正
──────────────────────────────────────────────────────────────
变更块
```

或者使用侧边栏的 **Review Changes** 视图，在不打开文件的情况下接受/拒绝某个文件的全部待审变更块。

### 5. 持续处理，直到没有待审变更为止

之后你可以继续工作、创建 Git 检查点、查看历史记录，或结束会话。

---

## 审查模型

### 会话基线

CodeBender 始终将新的工作与审查会话开始时捕获的状态进行比较。

这个起点可能已经包含：

- 已提交的代码；
- 未暂存的修改；
- 已暂存的修改；
- 包含未保存内容的已打开编辑器缓冲区。

这些预先存在的状态会被当作**基线**，而不是新的 AI 变更。

### 变更块隔离

如果一个文件包含多处独立修改：

```text
变更块 A   → 待审
变更块 B   → 待审
变更块 C   → 待审
```

那么：

```text
接受 A
拒绝 B
接受 + Stage C
```

会产生三个独立的决策。CodeBender 不会有意将它们合并成单一的文件级决策。

### 已删除的文件

一个被完全删除的文件没有编辑器缓冲区可以用来渲染 CodeLens 操作。因此 CodeBender 会把一次完整删除表示为 **Review Changes** 中的一个删除变更块，可以在那里接受、接受 + Stage 或拒绝。

---

## Review Changes 视图

侧边栏视图旨在快速回答两个问题：

1. **哪些文件仍有待审的变更块？**
2. **我想逐块审查这个文件，还是一次性决定它剩下的所有变更块？**

对于一个普通的已修改文件：

```text
src/services/user.ts       3 个变更块        ✓   ↶
```

- 点击文件 → 打开并逐块内联审查。
- 点击 `✓` → 接受该文件的所有待审变更块。
- 点击 `↶` → 拒绝该文件的所有待审变更块。

批量操作只影响所选的文件。

---

## 内联编辑器体验

CodeBender 使用 VS Code 的装饰、gutter 指示器和 CodeLens 控件，让审查决策始终贴近被修改的代码。

### Gutter 标记

待审变更块会在 gutter 中显示指示器，方便在浏览源码时保持审查位置可见。

### 导航

| 操作 | Windows / Linux | macOS |
|---|---|---|
| 下一个待审变更 | `Alt+Shift+Down` | `Alt+Shift+Down` |
| 上一个待审变更 | `Alt+Shift+Up` | `Alt+Shift+Up` |
| 撤销上一次决策 | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

### Explorer 徽标

有待审工作的文件可以在 VS Code 普通 Explorer 中显示徽标。

可以这样关闭：

```json
{
  "codeBender.explorer.badges": false
}
```

---

## 接受 + Stage

`接受 + Stage` 与 `git add <file>` 有意不同。

它的设计目标是只把**被接受的那个变更块**加入暂存区。

示例：

```text
src/auth.ts

变更块 1 → 接受 + Stage
变更块 2 → 待审
变更块 3 → 待审
```

预期的 Git 状态：

```text
STAGED（已暂存）
└── 变更块 1

WORKING TREE（工作区）
├── 变更块 2
└── 变更块 3
```

### 索引安全

CodeBender 读取当前的 Git 索引，将所选审查变更块应用到该索引内容之上，只有在操作没有歧义时才写回更新后的索引。

这一设计有助于保留：

- CodeBender 之前就已存在的暂存内容；
- 其他不相关的暂存变更块；
- 早于本次会话就存在的未暂存内容；
- 同一文件中其他待审的 CodeBender 变更块。

---

## Git-first 基线与版本管理

CodeBender 将 Git 用于两个互相独立的目的。

### 1. 审查基线与检查点

内部审查状态可以用 Git 对象和内部 ref 来表示，而不移动你的分支。

概念上表示为：

```text
refs/codebender/<会话>/checkpoints/<id>
```

### 2. 显式暂存

只有 `接受 + Stage` 会有意更新真实的 Git 索引。

### 干净的仓库

只要有可能，CodeBender 会直接复用 `HEAD` 作为基线。

### 有本地改动的仓库

如果工作区已经包含未提交的修改，CodeBender 可以通过一个隔离的临时 `GIT_INDEX_FILE` 捕获精确的初始状态。

```text
真实 Git 索引             → 保持不变
CodeBender 临时索引       → 基线树 / 检查点
```

这样可以避免创建基线时替换掉你的暂存区。

---

## 非 Git 工作区

推荐使用 Git，但并非必须。

Git 之外的文件夹会使用快照回退引擎。CodeBender 会：

- 排除常见的依赖/构建目录；
- 限制快照的大小和文件数量；
- 在并发 worker 启动之前先创建好快照存储目录；
- 避免此前出现过的 `globalStorage/.../snapshots/... ENOENT` 竞态问题；
- 保留拒绝变更块所需的初始状态。

默认排除的目录包括 `.git`、`node_modules`、`.next`、`dist`、`build`、`target`、`vendor`、虚拟环境目录以及覆盖率输出目录等。

---

## 请求修正

当生成的变更块已经接近正确、但还不足以直接接受时，使用 **请求修正**。

默认消息会让代理聚焦于所选的待审变更块：

```text
Reviewer correction request

Instruction: <你的反馈>
File: <相对工作区的路径>
Pending block: <类型与当前行>

Rules:
- Correct only this pending CodeBender block.
- Do not modify unrelated pending blocks.
- Work on the real workspace file.
```

### 上下文模式

```json
{
  "codeBender.agent.contextMode": "block+context",
  "codeBender.agent.contextLines": 40
}
```

可用模式：

- `block` — 仅所选变更块。
- `block+context` — 所选变更块加上附近的代码行。
- `file` — 变更块加上完整文件内容，受片段长度限制约束。

出于安全考虑，除非显式开启，CodeBender 不会自动按下回车键。

---

## 跟踪控制

当你需要进行与本次审查无关的手动修改时，CodeBender 可以临时暂停跟踪。

命令：

```text
CodeBender: Pausar seguimiento
CodeBender: Reanudar seguimiento
CodeBender: Pausar/Reanudar seguimiento
```

恢复跟踪后的冲突处理方式可以通过以下配置调整：

```json
{
  "codeBender.pause.conflictStrategy": "ask"
}
```

可选值：

- `ask`
- `keep-pending`
- `absorb-all`

---

## 配置

推荐的初始配置：

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true,
  "codeBender.git.checkpointOnDecision": false,
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true,
  "codeBender.explorer.badges": true,
  "codeBender.agent.default": "ask",
  "codeBender.agent.autoCreateTerminal": false,
  "codeBender.agent.executePrompt": false,
  "codeBender.agent.contextMode": "block+context",
  "codeBender.agent.contextLines": 40
}
```

### 重要配置项

| 配置项 | 默认值 | 作用 |
|---|---:|---|
| `codeBender.git.enabled` | `true` | 启用 Git 检查点与暂存集成。 |
| `codeBender.git.fastBaseline` | `true` | 使用惰性加载的、由 Git 支撑的会话基线。 |
| `codeBender.git.checkpointOnDecision` | `false` | 避免在每次审查操作后都创建一个 Git 检查点。 |
| `codeBender.inlineReview.enabled` | `true` | 启用内联逐块审查。 |
| `codeBender.inlineReview.showCodeLens` | `true` | 在待审变更块上方显示操作。 |
| `codeBender.explorer.badges` | `true` | 在 Explorer 中显示待审变更徽标。 |
| `codeBender.confirmReject` | `true` | 对破坏性的文件级/全部变更拒绝进行确认。 |
| `codeBender.agent.default` | `ask` | 选择目标编程代理。 |
| `codeBender.agent.executePrompt` | `false` | 插入代理反馈后自动按下回车键。 |
| `codeBender.agent.contextMode` | `block+context` | 随修正反馈一起发送的代码量。 |
| `codeBender.maxFileSizeMB` | `10` | 回退快照能处理的最大文件大小。 |
| `codeBender.maxFiles` | `20000` | 回退会话中包含的最大文件数量。 |

完整的配置 schema 请参见 `package.json`。

---

## 命令

命令面板中可用的主要命令：

| 命令 | 作用 |
|---|---|
| `CodeBender: Iniciar sesión de revisión` | 将当前状态冻结为审查基线。 |
| `CodeBender: Finalizar sesión` | 结束当前活动的审查会话。 |
| `CodeBender: Actualizar cambios` | 刷新待审变更。 |
| `CodeBender: Pausar seguimiento` | 临时停止跟踪新的编辑。 |
| `CodeBender: Reanudar seguimiento` | 恢复跟踪。 |
| `CodeBender: Siguiente cambio` | 跳转到下一个待审变更块。 |
| `CodeBender: Cambio anterior` | 跳转到上一个待审变更块。 |
| `CodeBender: Deshacer última decisión` | 撤销最近一次 CodeBender 决策。 |
| `CodeBender: Ver resumen de sesión` | 显示审查会话统计信息。 |
| `CodeBender: Crear checkpoint Git` | 创建一个显式的内部 Git 检查点。 |
| `CodeBender: Ver historial Git` | 查看可用的 Git 历史记录/检查点。 |

内联和树视图中的操作提供了具体到变更块/文件级别的命令。

---

## 性能模型

### 旧的全量快照方案

在一个较大的仓库中，可能需要：

```text
查找文件
  + stat 文件
  + 读取文件
  + 计算文件哈希
  + 写入快照副本
  + 创建 Git 检查点
```

### 当前的 Git-first 方案

对于一个干净的 Git 仓库：

```text
git status
   ↓
HEAD 基线
   ↓
就绪
```

如果在一个包含 10,000 个文件的仓库中只有四个文件发生了变化，CodeBender 可以只把审查工作聚焦在这四个文件上，而不是先复制整个工作区。

---

## 换行符与编码

CodeBender 对比较逻辑做了归一化处理，使得普通的 `LF` 与 `CRLF` 差异不会产生“整个文件已更改”的虚假审查变更块。

审查引擎同样不会把 UTF-8 BOM 的差异当作代码变更。

因此，打开一个 CRLF 文件、而其 Git 基线为 LF 时，在真正发生内容变更之前应当产生**零个**审查变更块。

---

## 安全原则

CodeBender 在破坏性操作上刻意保持保守。

### 它不需要

- 通过 `git reset --hard` 来启动一个会话；
- 通过 `git clean` 来管理审查状态；
- 为内部检查点切换分支；
- 仅仅为了创建基线就替换你真实的 Git 索引；
- 在你选择某个内联变更块操作时接受整个文件。

### 在一次破坏性批量拒绝之前

文件级拒绝可以配置为需要确认：

```json
{
  "codeBender.confirmReject": true
}
```

### 代理提示

CodeBender 会把修正提示插入到本地终端中。自动执行默认是关闭的：

```json
{
  "codeBender.agent.executePrompt": false
}
```

这让你有机会在发送之前先检查这条消息。

---

## 架构

```text
┌───────────────────────────────────────────────────────┐
│                       VS Code                         │
│                                                       │
│  Workspace ── 文件监听 ── 审查状态门控                 │
│      │                               │                │
│      │                               ▼                │
│      │                          变更块引擎              │
│      │                               │                │
│      │                  ┌────────────┴────────────┐   │
│      │                  │                         │   │
│      ▼                  ▼                         ▼   │
│  Git 基线          内联审查                    树视图  │
│  / 快照            + CodeLens                批量操作 │
│      │                  │                         │   │
│      └──────────────┬───┴──────────────┬─────────┘   │
│                     │                  │             │
│               Git 暂存           代理反馈             │
│                     │                  │             │
│                     ▼                  ▼             │
│                 Git 索引          本地终端            │
└───────────────────────────────────────────────────────┘
```

核心模块：

| 模块 | 职责 |
|---|---|
| `extension.js` | VS Code 生命周期、命令、视图、装饰、会话编排。 |
| `hunks.js` | 变更块检测与变更块级别的操作。 |
| `review-state.js` | “仅新变更”审查门控与会话审查状态。 |
| `git-versioning.js` | Git-first 基线、检查点、历史记录。 |
| `git-staging.js` | 已接受变更块的安全部分暂存。 |
| `agent-send.js` | 代理选择、修正提示构建、终端传输。 |
| `tracking-pause.js` | 暂停/恢复行为与冲突处理。 |

更多细节请参见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 测试

在源码目录下：

```bash
npm test
npm run check
```

回归测试套件覆盖了关键的审查路径，包括：

- 同一文件内彼此独立的变更块；
- 变更块级别的接受与拒绝；
- 部分 `接受 + Stage`；
- 保留预先存在的暂存/未暂存内容；
- 插入与删除；
- LF/CRLF 处理；
- BOM 处理；
- “仅新变更”审查门控；
- 代理提示传输；
- 文件级批量接受/拒绝操作。

---

## 故障排查

### 打开文件后显示有变更，但我并没有编辑它

请确认你使用的构建版本包含“仅新变更”门控和 EOL 归一化。当前版本会确保仅仅打开或激活一个文件不会产生审查操作。

如果问题仍然存在，请检查特定仓库的转换行为，例如 `.gitattributes`、打开/保存时自动格式化的扩展、生成的文件，或非标准编码。

### `接受 + Stage` 失败

如果所选变更块无法安全应用到当前 Git 索引，CodeBender 会有意中止操作。请检查同样的代码行上是否已经存在暂存的或早于本次会话的修改。

### `请求修正` 被拆分成多条终端消息

0.7.4 及之后的版本对多行提示使用 bracketed paste 传输方式。请确认你使用的是当前构建版本，并且目标终端支持标准的 bracketed paste 行为。

### 快照启动错误：`ENOENT ... globalStorage/.../snapshots`

当前版本会在并发回退 worker 启动之前先创建好快照目录。从旧版本更新后，请重新加载 VS Code。

### 没有出现内联控件

请检查：

```json
{
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

同时确认存在一个活动的审查会话，并且该编辑发生在会话开始之后。

---

## 项目状态

CodeBender 正在积极开发中。当前的设计重点是先确保本地审查语义的可靠性，然后再扩展更广泛的自动化能力。

### 当前优先事项

- 当代理在同一区域反复修改时，让变更块身份识别更具韧性；
- 提升与原生 AI 编辑审查体验之间的视觉一致性；
- 加强多根（multi-root）工作区下的行为；
- 改进代理归因和会话统计信息；
- 增加更丰富的 Git 检查点/历史记录界面；
- 在真实的 VS Code Extension Host 中扩展自动化集成测试的覆盖范围。

---

## 参与贡献

欢迎贡献代码、提交 bug 报告、可复现的边界情况以及设计提案。

在提交 pull request 之前，请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

有价值的报告通常包含：

- VS Code 版本；
- 操作系统；
- Git 版本；
- 会话开始时仓库是干净还是有未提交改动；
- 换行符配置（`.gitattributes`、`core.autocrlf`）；
- 使用的具体 CodeBender 操作；
- 最小化的复现步骤。

---

## 安全

请不要在公开 issue 中发布敏感的漏洞细节。项目的安全流程请参见 [`SECURITY.md`](SECURITY.md)。

---

## 许可证

CodeBender 基于 [MIT 许可证](LICENSE) 发布。

---

<p align="center">
  <strong>保持 AI 编程代理的速度，同时把最终决定权留给人。</strong>
</p>
