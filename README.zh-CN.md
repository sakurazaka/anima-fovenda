# Anima Fovenda

![Anima Fovenda — 记忆层](docs/banner.jpg)

> **只作分享，原样提供。** 这是自用工具，公开是为了让人看和 fork：**不接 issue，不看 PR**。想改就自己 fork。
>
> **早期版本（0.2.x），接口可能变。** 最近挪过位置的东西：`memctl add` 现在要 `--by owner` 或 `--from-pending`；`paths.mjs` 的 `P.handoff` 是目录。升级前先看 `CHANGELOG.md`。

DSH（DeepSeek Harness）的记忆审阅台：侧栏一个面板，六个 tab —— 待审、人格快照对比、规则、衰减/长期记忆、备忘、检索。

记忆文件默认只经 CLI 写，浏览器不直接碰；规则文件是唯一可直接编辑的文本面，保存前会备份并检查 mtime 冲突。

**任何一个会话都可以接着聊之前的任何话题**——不是因为它被塞进了上下文，而是因为需要时查得到：按天有骨架，按词有索引，结论落在共享层。接得上的是**事实和动机**；当时的心情不在里面，要还原就去读日记。

## 跟别的记忆方案差在哪

上面所有条目都源自同一个目标：**维持人格与记忆的连续性和正确性**——不是让模型自己记得更多，而是让「谁记住、记住什么、什么时候忘」始终可被审阅和修正。

| 维度 | 常见做法 | 这里 |
|---|---|---|
| 写入 | 自动沉淀、自动蒸馏 | **待审缓冲**：模型只投候选，默认不进热层，人点收 / 扔 |
| 每轮开销 | 每轮自动检索、注入一条参考 | 只注入 persona / rules 和骨架；细节按需拉（`recall`、`session-digest`） |
| 存在哪 | 向量库 / 云服务 / 单一数据库 | 按类型分文件：热层、长期事实、原话、运维、过程记录各归各的；能 `cat`、能 diff、能整个搬走 |
| 怎么检索 | embedding（多一个服务、多一份钱） | 本地 SQLite FTS5 + jieba + 层权重，离线、0 token |
| 操作粒度 | 分支级 / 状态级（合并或冻结） | **条目级**：拒一条、调一条的权重 |
| 会不会越记越乱 | 只增不减 | 衰减：重要的见底但不消失，次要的过期进归档，**归档不删** |
| 可观测 | 只有状态快照 | 六个 tab 当体检仪表盘：待审、热层、长期、人格 diff、检索、备忘 |
| 副作用 | 后台悄悄写 | 只有一个写入口（`memctl`），改 imp 记账到 `imp-log.jsonl`，能回查 |
| 依赖 | 一堆 npm 包 | 零 npm 依赖；Python 只有检索那层要 |

### 取舍，以及它给你留的后手

上面每一处「跟常见做法不一样」，都指向同一件事：**维持人格与记忆的连续性和正确性**，而不是让模型自己跑得飞快。代价是自动化程度低；换来的是**控制权始终在你手里**。

- **待审不分来源**（闲聊和决策同等进队）——不是没做分类，是刻意不在这里下判断：真正关键的不是「谁进队」，而是**去向由谁定**。去向由你，或者我们一起定。
- **decay 不进系统提示**。它是每晚拉取一次的记忆块，不是每轮注入。所以就算有条目写歪了，也不会当场污染每一轮；你在审阅台发现异常，随时可以查、可以让 agent 核对、可以修剪。
- **不做窗口内切割**：换话题之后旧内容还在同一个上下文里。要干净就开新窗、走交接包——那是一条显式的动作，不是自动发生的猜测。
- **情绪不进上下文**。原话在 `raw`、心情在日记，两者都不参与注入。一是不失真（情绪压成标签就是编的），二是真把一大堆情绪读进来，判断会先垮掉。要还原当时的状态，去读日记，别让模型猜。
- **人不出勤就不进热层**：这是它的代价，也是它的保证——没有任何东西能绕过你的判断偷偷进热层。

一句话：**用自动化换稳定，用后手换纠错能力**。这套东西不是「更聪明的记忆」，是「可以被你审计和修剪的记忆」。

**一个例子**：某天一个重要条目被误归档。例行检查里某一档的数字少了，改动记录里却没有对应的变化——对不上，就是线索。顺着 id 查得到来龙去脉，能按备份放回去，能补一条断言让它不再发生。黑盒也会出错，只是它不告诉你，也不给你 id。

**License:** MIT · **作者：** 桜坂珠洲音 · **包名：** `anima-fovenda` · **API：** `/anima-fovenda/api`

- **数据根：** 用 `ANIMA_DATA` 或 `ANIMA_PATHS` 指定；插件不猜用户目录。
- **安全：** 先读 [SECURITY.md](SECURITY.md) —— 本地 API **没有 token 鉴权**。

## 包里有什么

```
plugin/           DSH 插件（host + Web client + locale + icon）
runtime/          CLI 工具 + 空 identity 模板
preview/          静态 HTML 预览，无后端、无真实数据
docs/             README 头图（banner.jpg / social-preview.png）
unit-test.mjs     客户端纯函数测试
LICENSE
```

**不含：** 任何真实记忆、日记、人格、规则、备忘、handoff；也不含定时任务、自动备份、看片/inject 流程。这些都属于具体部署。待审队列也不会自己长条目，必须由外部的 agent / CLI 调 `pending.mjs add`。

## 首次安装前

- **DSH 0.2.x**（Desktop 或 Web 均可）。
- **Node.js 20+**，并且终端里能直接跑 `node`。先用 `node --version` 确认；如果 DSH 自带的 Node 不在 PATH，就用它的完整 `node.exe` 路径，或者自己装 Node 20+。
- 下面的命令按 **Windows** 写。Linux/macOS 把 `xcopy` / `copy` 换成 `cp -R`，把 `setx` 换成 `export`。
- **检索是可选功能**：需要 Python 3 + `jieba`；会话索引额外需要 `zstandard`。没装只影响检索 tab，其他 tab 正常。
- 解压 zip。**包根目录**是包含 `plugin/`、`runtime/`、`README.md`、`package.json` 的那一层。

## 首次安装

在包根目录打开终端。把 `D:\anima-fovenda` 和 `D:\anima-data` 换成你自己的路径。

### 1. 建数据根

```bat
node runtime\tools\init.mjs D:\anima-data
xcopy runtime\tools\* D:\anima-data\tools\ /E /I /Y
copy runtime\memctl.mjs D:\anima-data\
```

`init.mjs` 会建 `memory/`、`identity/`、`MEMO.md`、`CHANGELOG.md`，不会覆盖已有文件。

生成的东西分两类：**带结构模板的**（`facts.md`、`self/self.md`、`self/voices.md`、`ops.md`、`MEMO.md`、四个 `.jsonl`）和**空的**（`identity/persona.md`、`identity/rules.md`——人格和规则要自己填）。所以包里不带这些文件，一律以 `init.mjs` 生成的为准。

### 人格注入（可选）

**先搞清楚一件事**：插件的「人格」页**永远只展示** `<数据根>\identity\persona.md`，跟你用哪条注入路线无关。页面上有 20 行，只说明那个文件有内容，**不代表它已经在生效**。

人格进系统提示有三条路，选一条：

| 路线 | 怎么做 | 谁适合 |
|---|---|---|
| ① `personaPrefix`（编译进 profile） | 写进 `cordis.patch.yml` 的 `system-prompt.personaPrefix` | 想把人设钉死在配置里、不依赖插件 |
| ② `ANIMA_PERSONA_SECTION=1` | 插件把 `persona.md` 注册成 system prompt 段，每轮重读文件 | **第三方默认推荐**：改文件就生效，不用碰 patch |
| ③ 都不设 | 只展示，不进提示 | 只是想有个地方记着人设 |

选 ② 的话：

```bat
setx ANIMA_PERSONA_SECTION 1
```

改人格就改 `identity/persona.md`，不要跑 `persona-sync`，也不要再改 `system-prompt.personaPrefix`。

**三条路只能选一条**。同时开 ② 和非空的 ①，人格会注入两遍。

### 2. 指向数据根

```bat
setx ANIMA_DATA "D:\anima-data"
```

或者直接指到路径解析器：

```bat
setx ANIMA_PATHS "D:\anima-data\tools\paths.mjs"
```

`setx` 只影响新进程；设完要**完全退出 DSH 再重开**。两个变量都没设时，插件会拒绝启动并打印试过的路径。

### 3. 安装插件

用 DSH 的插件管理器，目标选本包的 `plugin/` 目录；或者手写 profile：

```json
{
  "dependencies": {
    "anima-fovenda": "link:D:/path/to/anima-fovenda/plugin"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "anima-fovenda"]
    }
  }
}
```

再在 `cordis.patch.yml` 里插入：

```yaml
- insert:
    - id: anima-fovenda
      name: 'anima-fovenda'
```

手改过 `package.json` 的话，在 profile 目录跑一次 `pnpm install`。

### 4. 重启并验证

host 半边是模块级加载，装完/改了 `index.js` 要**重启整个 DSH**；只刷页面不够。client 改动刷页面即可。

```bat
curl "http://127.0.0.1:<port>/anima-fovenda/api?action=state"
```

返回 `{"ok":true,...}` 就是挂上了。没挂上时这个路径会 404。

### 5. 首次打开检查

- 侧栏出现 **Anima Fovenda**，点进去。
- **待审** 默认显示 `暂无`（除非队列里已经有条目）。
- **规则** 默认是空的，直到你往 `identity/rules.md` 写内容；空文件 = 不注入规则。
- **人格** 默认可能为空，直到 `identity/persona.md` 有内容、并且有快照。
- **记忆 / 备忘** 在全新数据根上可能是空的，正常。
- 装完**不会**自动获得定时任务、自动备份、看片/inject 流程，这是正常的。

## 故障排查

| 现象 | 先查什么 |
|---|---|
| 侧栏没有 Anima Fovenda | 装完是否完全重启 DSH？插件管理器目标是否是 `plugin/`？`plugin/package.json` 是否带 BOM？ |
| API 返回 404 | host 没加载。看 DSH 日志、profile 的 bundle 列表、`ANIMA_DATA`。 |
| `找不到 tools/paths.mjs` | `ANIMA_DATA` 要指向包含 `tools/paths.mjs` 的那层；`setx` 后要开新终端。 |
| 规则页是空的 | 正常，identity 模板本来就是空的；写 `identity/rules.md`。 |
| 检索 tab 报错 | 先读错误原文：它会说明试过哪些解释器。备好 Python 3 + `jieba`（会话索引再加 `zstandard`）。 |
| 改了设置但 DSH 没变 | `setx` 只影响新进程；完全退出 DSH 再重开。 |
| UI 改了没生效 | client 改动刷页面；`index.js` 改动要重启 DSH。 |

## raw 原文层

host 会把已提交的会话事件追加到 `memory/raw/YYYY-MM-DD.jsonl`：

- 用户文本（`source.kind === "user"`；runtime / time context 跳过）
- 助手文本（只取 text block；只有 reasoning / tool-call 的中间步跳过）
- tool 调用/结果**元数据**，不存结果正文
- 压缩元数据写到 `memory/raw/compaction.jsonl`（shadowed 范围、摘要长度；不存摘要正文）

只追加，不自动注入。设 `ANIMA_RAW=0` 可关闭。以后做压缩摘要时，从 raw 读到 checkpoint 为止，不能覆盖 raw。

`mem-index.py` 会把 raw 的 user/assistant 文本作为低权重 `raw` 层索引进检索；tool 元数据不索引。超过 30 天的日文件可以手动跑 `node runtime/tools/raw-cold.mjs --days 30` 压成 `.jsonl.gz`；只压缩，不删内容。这两步都不由插件自动调度。

## 待审队列

插件只提供队列和收/扔/改投，**不决定什么时候投料**。常见判据：

- 用户说「记住 / 以后 / 别再 / 规矩」，但没说放哪层；
- 一条结论以后用得上，但不确定放 facts / self / voices 哪层；
- 反复犯同一个错，还没想好写成什么规则。

条目必须有来源（`--src`）；收/扔由人决定。每天几条、什么时候投，是部署约定，不是插件默认。

收进衰减时，卡片会显示 agent 的**建议 imp**；你选最终值。decay 里只存最终 imp，建议值和最终值都写进 `imp-log.jsonl`，方便以后校准。

### 0.2.5 起：`memctl add` 有软闸

衰减层是「热层」（会被注入每轮提示），所以 0.2.5 给它加了一道闸：

```bat
node memctl.mjs add "…"                      → 拒绝（退出码 1），并提示下面两种做法
node memctl.mjs add "…" --by owner           → 通过（你本人明说「这条特别」时用）
node tools\pending.mjs add "…" --src "来源"  → 投待审；收的时候自动带 --from-pending
```

`pending.mjs` 的收/投两条路径会自动带 `--from-pending`，正常用队列不受影响。这道闸只拦「绕过队列直接写」。

## 每日时间线（0.2.5 起）

`tools/session-digest.mjs` 从 `memory/raw` 压出「哪个窗、什么时候、起首那句话」，不调模型、0 token：

```bat
node D:\anima-data\tools\session-digest.mjs                        :: 打到屏幕
node D:\anima-data\tools\session-digest.mjs --write                :: 落盘 memory\timeline\<日期>.md（幂等，重跑覆盖）
node D:\anima-data\tools\session-digest.mjs --session <前缀> --tail 5   :: 取某会话最近几轮
```

它的定位是**索引**不是**日记**：只记事实骨架（窗 / 时间 / 起首句），判断和感想不写。适合挂到每日收工任务里，让「今天在别的窗发生了什么」不会变成空白。

## 检索（可选）

**新装的索引是空的**：`init.mjs` 只建目录，不建库；`identity/` 是空模板，raw 也要等插件跑起来捕获会话事件才有。所以在有内容之前，检索只会返回空——这不是坏了。判断方法：

```bat
python D:\anima-data\tools\mem-index.py stats
```

- 报「索引还没建」→ 先跑一次 `build --docs`
- 有 raw 块、文档层 0 块 → 正常，能搜到对话原话，搜不到「关于他」的事实（模板是空的）
- 0 块 → 先确认 `memory\raw` 下有 `.jsonl`，再重建

需要 Python 3 + `jieba`；会话索引还要 `zstandard`。插件不依赖 `rt.mjs`：它会先试 PATH 里的 `python` / `py` / `python3`，再试 `%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\python`，每个都用 `import jieba` 验证一遍。

装好之后工具在**数据根**下，不在包目录里：

```bat
python D:\anima-data\tools\mem-index.py build --docs
python D:\anima-data\tools\mem-index.py recall "问题" --k 5
```

会话文件默认在 `%USERPROFILE%\.dsh\sessions` 下自动找；也可以用 `ANIMA_SESSIONS` 指向一个目录或单个 `session.v4.jsonl.zstd`。没装 Python 依赖时只有检索 tab 失败，其他 tab 正常。

## 定期维护（备份 + 重建索引）

两件事要定期做：**备份**、**重建索引**。

**跑法：挂在你已有的 DSH 定时任务后面就行**（读日记、写推送那条）。理由是一条链子：

> DSH 不在线 → 没有新内容 → 不需要增量备份 → 也就不需要专门的调度；
> 而且 OS 跑完的结果，到头来还是要 DSH 或人来看。

所以单为机械步骤再开一条调度是多余的。**OS 计划任务只在一种情况才有意义**：你想让备份彻底脱离 DSH（比如定时把整个数据根同步到另一台机器）。即便那样也要清楚——DSH 离线时它备份的是同一份内容。

**真正要防的是「跑了但没效」**——我们踩过：一条同步命令往已经不存在的路径写了半个月，没人发现。所以无论谁跑，都要报数字并对门槛：

- 备份：文件数 / 总大小；比上次少 5% 以上 → 报异常
- 可重建包：大小；不存在或 < 1 MB → 算失败
- 索引：`chunks_total`；为 0 → 报「没内容可索引」
- 时间线：写了几个窗；为 0 → 报异常

### 备份

- 备份 = 把**整个数据根目录**复制走；唯一可排除的是 `memory\index\`（可重建，几十 MB）
- 不可重建、必须备：`memory\raw`（原始对话，丢了就没了）、`decay.jsonl`、`full.jsonl`、`pending-facts.jsonl`、`facts.md`、`self\`、`identity\`、`MEMO.md`、`CHANGELOG.md`
- **隐私**：`raw` 是未脱敏的全文捕获，备份文件也要当敏感数据保管，别随手扔公共网盘
- 恢复：复制回来 → 跑一次 `init.mjs`（幂等，不覆盖已有文件）→ 重建索引

```bat
:: 可选：只在「想让备份脱离 DSH」时用
schtasks /create /tn "anima-backup" /tr "robocopy D:\anima-data C:\backup\anima-data /MIR /XD D:\anima-data\memory\index" /sc daily /st 03:00
```

```bash
# Linux / macOS
0 3 * * *  rsync -a --exclude 'memory/index' /path/anima-data/ /backup/anima-data/
```

### 重建索引

- 索引**不会自动更新**，而 raw 每天在长
- 但**最近几天不重建也能搜到**：`recall` 发现索引落后会补扫最新 raw（0.2.3 起的兜底），长历史才必须重建
- 挂在你那条 DSH 定时任务里（收工前跑一次）即可

```bat
python D:\anima-data\tools\mem-index.py build --docs
```

如果你确实用了 OS 计划任务：它的环境和交互式不同，PATH 里常常没有 node/python，命令里写绝对路径；`PYTHONPATH` 指到 `tools\pylibs`，`PYTHONIOENCODING=utf-8`。

## 让机器替你盯（可选）

`tools\check-open.mjs`：把「报错」变成**有状态**的东西。检查不通过就登记，之后每次跑都重提；检查通过就**自动结案**——不需要谁记得去删，否则「等人删」和「等人看报告」是同一个依赖。

```bat
node D:\anima-data\tools\check-open.mjs          :: 跑一遍，打印仍开着的
node D:\anima-data\tools\check-open.mjs list     :: 只看台账
node D:\anima-data\tools\check-open.mjs --json   :: 给定时任务用
```

内置四项机械检查（不需要模型判断）：

| key | 断言 |
|---|---|
| `imp_ge4_archived` | 归档里 `imp≥4` 的条数为 0 |
| `decay_subset_full` | `decay` 里每条都能在 `full` 里找到 |
| `index_present` | 索引文件存在且不是空壳（< 8 KB 判空） |
| `pending_dup` | 待审队列里同一段文本不重复 |

台账在 `memory\open-issues.jsonl`（key / 首次发现 / 已经几次 / 怎么修），结案留档在 `open-issues-closed.jsonl`。超过 3 天没修会在输出里标红。

机器判不了的问题（得靠人看）可以手工登记：

```bat
node D:\anima-data\tools\check-open.mjs add --key my_check --what "现象" --how "怎么修"
node D:\anima-data\tools\check-open.mjs close my_check --why "已修"
```

**建议挂在定时任务里当第 0 步**：每天先跑它，把 `open` 逐条写进当天报告的「异常」节。这样没人看报告也不会丢——它会一直重提，直到被修掉。

## 安全

- API 只监听 `127.0.0.1`，不加 CORS 头。
- **请求边界（0.2.4 起）**：`Host` 和 `Origin` 必须是回环地址（挡 DNS rebinding 和「任意网页发个 GET 就能改写 rules」）；写操作只接受 `POST` + `application/json`，`GET` 只能做读。非回环 Origin 返回 403，写操作走 GET 返回 405。
- 仍然**没有 token 鉴权**：同机其它进程照样能调读接口，写接口也只需伪造本机 Origin。不要把端口暴露到公网，也不要让不信任的进程跑在同一台机器上。
- `file` 只接受白名单 key，浏览器拿不到任意路径。
- 写入走 `pending.mjs`、`memo.mjs` 或受保护的规则接口；规则接口检查 mtime、写 `.bak`、原子替换；待审队列是进程锁 + 原子写 + 写前备份。
- 请求体上限 1 MB；CLI 子进程 10 秒超时。

## 测试

```bat
node unit-test.mjs
node runtime\tools\test-rules.mjs
```

`test-rules.mjs` 会自己在系统临时目录建一个隔离数据根，跑完删掉，**不会**写真实队列（0.2.4 起；0.2.3 及以前会写一条 `src: test-rules.mjs 自动写入` 的自检条目）。API smoke/e2e 需要运行中的 DSH 和完整数据根，不作为「解压即跑」的承诺。

## 把包交给别人时

这个包本身不含任何真实数据，也**不含任何模板文件**——`identity/` 和记忆层的空壳都由 `init.mjs` 生成。但如果是从**自己的部署目录**打包或压缩后发给别人，注意排除：

- `memory/raw/` —— 完整捕获了你自己和助手的所有原文，没有脱敏；
- `memory/` 下其它派生数据（`decay.jsonl`、`facts.md`、`self/`、`daily/`）与 `MEMO.md`；
- `identity/persona.md`、`identity/rules.md` —— 写过的版本就是你的提示词；
- `*.bak-*`、`memory/.queue-baks/`、`memory/.pre-route/` —— 都是副本，同样带原文；
- `~/.dsh/.secrets.json` 之类的凭据文件（本来就不在这个包的范围里，别顺手带上）。

对方拿到的应该是 `plugin/` + `runtime/` + `preview/` + 文档这一套，然后按上面「首次安装」自己建数据根。

## 预览

浏览器打开 `preview/ui-preview.html`。纯静态视觉 mock：不连 API、不读数据、不写文件。可以用 `?tab=memory&theme=dark` 直接跳视图。

## License

MIT，见 `LICENSE`。Copyright (c) 2026 桜坂珠洲音。
