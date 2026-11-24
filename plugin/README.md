# Anima Fovenda · 记忆审阅台

DSH（DeepSeek Harness）的 Web UI 插件：侧栏一个图标，主区六个 tab，用来审阅和整理一个本地记忆目录。

- 包名：`anima-fovenda`
- 源码树本地安装名：`@local/anima-fovenda`；公开导出包名：`anima-fovenda`
- License：MIT
- Copyright：桜坂珠洲音
- 入口：`index.js`（host）+ `client.js`（Web 客户端）
- API：`/anima-fovenda/api`
- 数据根：由 `ANIMA_PATHS` 或 `ANIMA_DATA` 指定，插件不猜路径

## 1. 它做什么

一个「记忆」目录通常有这些层：

| 层 | 文件 | 说明 |
|---|---|---|
| raw | `memory/raw/YYYY-MM-DD.jsonl`（老的为 `.jsonl.gz`） | 每轮用户/助手原文、tool 元数据、压缩边界；只追加，不自动注入；可被 `mem-index` 以低权重索引 |
| 待审 | `memory/pending-facts.jsonl` | 新条目先落这里，人工收/扔后才进衰减层；插件不投料，谁投 / 何时投由外部 agent / CLI 决定 |
| 衰减 | `memory/decay.jsonl` | 有权重、清晰度、归档天数的日常记忆；归档不删除，只是不再注入 |
| 长期 | `memory/facts.md`、`memory/self/*.md` | 稳定事实、我的失败模式、他的原话 |
| 备忘 | `MEMO.md` | 未办完 / 未想好的事，表格 |
| 纪律 | `identity/rules.md` | 每轮注入系统提示的一段规则 |
| 人格 | `identity/persona.md` + `memory/persona.snapshots/` | 人设文本和快照 |
| 索引 | `memory/index/mem.db` | 全文检索索引（可重建） |

插件不直接改这些文件。除了 `rules.md`（配置，不是数据），所有写操作都 spawn 数据根里的 CLI：

```
pending.mjs accept|reject   → memctl.mjs 写 decay
memo.mjs set                → 改 MEMO 状态
memctl.mjs imp              → 改权重并写审计
```

> 插件本身**不含定时任务、自动备份或看片流程**；这些是本机外部配置，其他部署默认没有。待审队列也不会自己长条目：投料由使用者的 agent / CLI 决定。

## 2. 前置条件

- DSH 0.2.x（Desktop 或 Web 均可）
- Node.js 24（DSH 自带运行时即可）
- 可选：Python 3 + `jieba` + `zstandard`，只影响「检索」tab；没有时检索会报错，其它 tab 正常

## 3. 安装

### 3.1 建数据树

在本仓库根目录：

```bat
node data\tools\init.mjs D:\anima-data
```

`init.mjs` 只建目录和模板文件（memory / MEMO / CHANGELOG），不覆盖已有文件。

然后把运行时脚本复制进去：

```bat
xcopy data\tools D:\anima-data\tools\ /E /I /Y
copy data\memctl.mjs D:\anima-data\
mkdir D:\anima-data\identity
```

`init.mjs` 不建 `identity/`，手动建，并放入两个文本文件：

```bat
type nul > D:\anima-data\identity\rules.md
type nul > D:\anima-data\identity\persona.md
```

- `rules.md`：你的纪律。空文件 = 不注入。
- `persona.md`：人设展示用，可留空。

> 也可以直接把仓库里的 `data/` 当数据根（它已经包含 tools / memctl / identity），但不要把别人的私有记忆一起发布。

### 3.2 设环境变量

插件**只认**这两个变量，至少设一个：

```bat
setx ANIMA_DATA "D:\anima-data"
```

或者直接指到 `paths.mjs`：

```bat
setx ANIMA_PATHS "D:\anima-data\tools\paths.mjs"
```

两个都没设时，插件会拒绝启动并打印试过的路径，不会静默退回某个用户目录。

`setx` 只影响新进程；设完要重启 DSH。

### 3.3 挂插件

**方式 A：插件管理器（推荐）**

在 DSH 的插件管理里安装本地 bundle，目标选本仓库的 `plugin/` 目录。它会做 junction 链接，改源文件即改生效文件。

**方式 B：手写 profile**

在 DSH profile 的 `package.json` 里加依赖和 bundle：

```json
{
  "dependencies": {
    "anima-fovenda": "link:D:/path/to/Anima Fovenda/plugin"
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

然后在 profile 目录跑一次 `pnpm install`（或用插件管理器安装）。

### 3.4 重启并验证

host 半边是模块级加载，**改完 `index.js` 必须重启整个 DSH**；只刷页面不够。client 半边改完刷页面即可。

重启后：

```bat
curl "http://127.0.0.1:<port>/anima-fovenda/api?action=state"
```

返回 `{"ok":true,...}` 即挂上。旧 API 路径应当 404——如果它还 200，说明跑的还是旧模块。

## 4. 六个 tab

| tab | 干什么 | 写入吗 |
|---|---|---|
| **待审** | 队列卡片；收进衰减 / 扔掉 / 收进长期（facts / self / voices）。侧栏图标带未处理数角标 | 是，走 `pending.mjs` |
| **检索** | 全文检索：文档、日记、会话、衰减层、失败模式、原话；规范层加权 | 否 |
| **备忘** | 读 `MEMO.md` 的表格，点状态直接改（未做 / 部分 / 搁置 / 完成） | 是，走 `memo.mjs` |
| **规则** | 编辑 `identity/rules.md`；mtime 冲突检测 + 写前备份 + 原子替换；保存后下一轮注入生效 | 是（配置，不是记忆数据） |
| **人格** | 读 `identity/persona.md`，和快照做并排 diff，看改了什么 | 否 |
| **记忆** | 衰减层（权重 / 清晰度 / 归档）+ 长期层（facts / self / voices 只读） | 否 |

侧栏图标右上角的蓝点数字是待审队列数量，约 45 秒轮询一次。

## 5. API

所有动作都走一个入口：

```
GET  /anima-fovenda/api?action=state
GET  /anima-fovenda/api?action=file&file=facts
GET  /anima-fovenda/api?action=recall&q=...&k=5
GET  /anima-fovenda/api?action=rules
GET  /anima-fovenda/api?action=imp-log
GET  /anima-fovenda/api?action=summary
POST /anima-fovenda/api   {"action":"accept","id":"..."}
POST /anima-fovenda/api   {"action":"reject","id":"...","reason":"..."}
POST /anima-fovenda/api   {"action":"rules-save","text":"...","mtime":...}
POST /anima-fovenda/api   {"action":"memo-set","num":2,"status":"✅"}
POST /anima-fovenda/api   {"action":"imp-set","id":"...","imp":4}
```

- 只监听 127.0.0.1，无 CORS 头，没有鉴权。
- `file` 只接受白名单 key，挡路径穿越。
- `rules-save` 带 mtime 冲突检测；写前备份，临时文件 + rename 原子替换。

## 6. 目录

```
plugin/
  index.js          host：路径 bootstrap、文件读取、HTTP 路由、spawn CLI
  client.js         Web 客户端：React.createElement，无 JSX、无构建步骤
  package.json      dsh.client / dsh.bundle 声明
  cordis.patch.yml  bundle patch：插入 anima-fovenda 这一行
  locale/           面板标题和描述的 en / zh 元数据
data/
  tools/            init / paths / pending / memo / mem-index 等
  memctl.mjs        记忆权重与衰减的唯一写入口
  identity/         persona.md / rules.md（发布时用模板，不要带私人内容）
```

## 7. 开发与测试

```bat
node smoke-test.mjs --base http://127.0.0.1:<port>/anima-fovenda/api
node e2e-test.mjs   --base http://127.0.0.1:<port>/anima-fovenda/api
node unit-test.mjs
node data\tools\test-rules.mjs
node data\tools\check-patch-ids.mjs
```

- `smoke-test.mjs`：接口 41 项 + BOM 检查 + 对账
- `e2e-test.mjs`：路径、只读脚本、沙箱写入、备份对账、本机 DSH 定时任务路径（可选；插件本身不建任务）、插件接口
- `unit-test.mjs`：从 `client.js` 里拿纯函数单测（37 项）
- `test-rules.mjs`：衰减参数 + 待审队列闸（18 项；会写一条测试条目再 reject）
- `check-patch-ids.mjs`：升级后查 patch 引用的 id 是否还在

`test-rules.mjs` 不想在真队列留测试记录，就把 `ANIMA_DATA` 指到数据副本再跑。

## 8. 已知限制

1. 「升为常驻」在当前配置里**只预览**：persona 已编译进系统提示层，界面不落盘。如果别的部署直接读 `persona.md`，这个动作需要改成写盘——导出时按部署方式调整。
2. UI 文案目前写死中文；`locale/` 只覆盖面板标题和描述。
3. 深色主题没系统验过（颜色 token 成对，理论跟得上）。
4. 面板高度依赖宿主容器；某些窗口尺寸下会塌成内容高度。
5. host 改动必须重启 DSH；client 改动刷页面即可。
6. `/anima-fovenda/api` 只适合本机使用，不要暴露到公网。
7. 「检索」依赖 Python 索引；没装依赖时该 tab 会报错，不影响其它 tab。
8. 插件不含定时任务、自动备份或看片流程；22:00 备份、日记推送、inject 之类都是本机外部配置，不随插件安装。
9. raw 捕获默认开启，写 `memory/raw/YYYY-MM-DD.jsonl`；`mem-index` 以低权重把 user/assistant 文本索引进检索，不自动注入。设 `ANIMA_RAW=0` 可关闭。超过 30 天的日文件可手动跑 `tools/raw-cold.mjs` 压成 `.jsonl.gz`；只压缩，不自动删除。
10. 人格默认只在「人格」页展示；设 `ANIMA_PERSONA_SECTION=1` 才会把 `identity/persona.md` 注册成 system prompt section。已有非空 `personaPrefix` 的部署不要开，否则人格注入两遍。
