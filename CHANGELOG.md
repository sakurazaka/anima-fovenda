# Changelog

## 0.2.9 — 2026-11-28

两个让「重要记忆会消失」的 bug，一个在归档判定、一个在注入回写。由一次自查发现（报告显示 imp≥4 的条目被归档了，而规则写的是永不归档）。

- **归档门槛拿错了参数**（`decay()`）：代码写的是 `exitAge(r)`——传了整个记录，但函数期望 imp。对象比较得到 `NaN`，于是**所有条目都按 30 天走**，`imp≥4` 的 `Infinity` 从未生效。
  更巧的是 `floor=0.4`、速率 `0.02/天`：`1.0 − 0.02×30 = 0.4` 正好等于门槛，所以 imp5 只要 30 天没被读到就**必然**归档。实测 5 条误伤全是入库 31 天、clarity 刚落到 0.4。
  修法：抽出纯函数 `shouldArchive(r)`，内部只认 `r.imp`；`decay()` 改调它。
- **`inject()` 会把归档条目物理删掉**：它先 `filter(state !== 'archived')`，再把这个结果**整份写回** `decay.jsonl`，于是每跑一次注入，归档条目就从文件里消失——「归档不删除、可恢复」形同虚设。
  修法：整份读进来，回写时只改本轮被读到（续命）的条目，归档原样带过。
- **测试补上归档判定**：`test-rules` 此前只测 clarity 公式，从没走「归档门槛」这条路径，所以这个 bug 活了 21 天。现在有 6 条断言：`imp=4/5` 见底且龄 200 天不归档；`imp=3` 龄 40 天不归档、100 天归档；`imp=2` 龄 40 天归档、10 天不归档。
- **新增 `tools/check-open.mjs`（未结问题台账）**：把「报错」变成有状态的东西——检查不通过就登记，之后每次跑都重提，**检查通过自动结案**（不靠谁记得去删）。内置四项机械检查：归档里不许有 `imp≥4`、`decay ⊆ full`、索引文件存在且非空、待审队列不重复。台账 `memory/open-issues.jsonl`，结案留档 `open-issues-closed.jsonl`。建议挂在定时任务的第 0 步。

升级到本版后，**旧数据不会自动复原**——被归档或被删掉的条目需要用你自己的备份重放（本项目作者的恢复做法：以修复前的 `decay.jsonl` 备份为来源，用新的 `shouldArchive` 重算，该活跃的恢复活跃、该归档的重建为归档；不要用 `full.jsonl` 当来源，它存的是入库时的原始 imp，不反映后来的降级）。

## 0.2.8 — 2026-11-25

`init.mjs` 成为模板的唯一来源，并修了两处跟当前代码不一致的旧结构。

- **`init.mjs` 现在也生成 `identity/`**：`identity/persona.md`、`identity/rules.md`（空文件）。此前身份模板靠包里 `runtime/identity/*.md` 现拷，而 `facts.md` / `self/` / `voices.md` 等靠 `init.mjs` 生成——同一类东西两处来源。现在**包里不再带任何模板文件**，一律以 `init.mjs` 为准。
- **修 `memory/handoff.md` → `memory/handoff/`**：`paths.mjs` 里的 `handoff` 从 2026-11-24 起已经是目录（一个项目一份），但 `init.mjs` 还在生成单文件，新装的人会拿到一个没人读的死文件。现在生成目录 + 一份说明 `README.md`。
- **补 `memory/timeline/`**：0.2.5 加的每日时间线要写到这个目录，此前 `init.mjs` 不建它。
- 文档同步：安装步骤去掉 `xcopy runtime\identity\*`；README 与 SECURITY 里「`runtime/identity/*.md` 是 0 字节模板」改成「包里不含任何模板文件，全部由 `init.mjs` 生成」。

## 0.2.7 — 2026-11-25

修一个会让插件**在第三方机器上直接加载失败**的打包错误。

- **`plugin/client.js` 的注册 id 改回 `anima-fovenda`**。0.2.5 我把现役源码整份同步进包时，把
  `id: '@local/anima-fovenda'` 一起带了进去；而 `package.json` 的 `name` 和 `cordis.patch.yml`
  的 bundle id 都是 `anima-fovenda`。DSH 客户端加载器按 `name` 查注册，看到模块执行完没注册这个键，
  就报错。
  **注意这是有意的双名**：现役部署那份必须是 `@local/anima-fovenda`（profile 里按这个名 link），
  发布包必须是 `anima-fovenda`。打包时不能直接覆盖。
- **新增 `tools/check-package.mjs`**（仓库自用，不进包）：校验
  client 注册 id / package name / bundle id 三者一致、发布包不带 `@local/` 前缀、必要文件都在、
  没有机器痕迹（本机用户名、绝对路径）。CI 的 `pack` job 里也加了同名校验，以后这类错进不了仓库。
- 由第三方部署报出，他们已在自己机器上打补丁绕过；官方包在此修正。

## 0.2.6 — 2026-11-24

把「查不到」拆成三种情况，改掉几处会误导人的界面文案，补上定期维护的说明。

- **索引状态不再混成「没命中」**（实证来自第三方部署）：`recall` 现在分三种情况——
  ① `mem.db` 不存在 → 「索引还没建：先跑 `build --docs`」；
  ② 库在但表缺失 → 同上；
  ③ 表在但 0 块 → 「索引是空的（0 块）：先确认 `memory/raw` 或文档里有过内容」。
  只有「有内容但真没命中」才保持安静。此前这三种都返回 `[]`，界面上统一显示「没命中」，把人引向错误方向。
- **`recall` / `stats` 不再顺手造空库**：以前无条件 `sqlite3.connect` 会在没有索引时创建一个空 `mem.db`，看起来像「索引建好了」。现在先判文件存在。
- **`build` 在 0 块时告警**：明确说「没有任何可索引内容——先确认 raw 或文档里有文字」，而不是安静地报 `chunks_total: 0`。
- **`stats` 增加判断提示**：只有 raw 层有块、文档层全空时，提示「能搜对话原话，搜不到关于他的事实（模板是空的）」。
- **人格页文案改正**：不再暗示「人格在系统提示里每轮付费」。现在写清：本页始终展示 `identity/persona.md`，是否进提示取决于部署（`personaPrefix` / `ANIMA_PERSONA_SECTION=1` / 都不设 = 只展示）；分层表同理。
- **README**：人格三种路线对照表；新增「定期维护」节（备份范围 + 索引重建 + 调度方式与结果门槛）；检索段补「新装索引是空的」。

## 0.2.5 — 2026-11-24

热层写入加闸，日记索引补日期，新增每日时间线工具。

- **`memctl add` 加软闸（行为变更，注意）**：不带 `--by owner` 或 `--from-pending` 会**直接拒绝**（退出码 1），并打印「走待审」或「本人绕过」的做法。原因：衰减层是会被注入的热层，以前任何脚本都能直接写；堵死会把「他明说特别」这条路也堵掉，所以做成软闸。**`pending.mjs` 的收/投两条路径会自动带 `--from-pending`，正常用待审不受影响。**
- **待审投料带判据提示**：`pending.mjs add` 成功后多打一行「只记关于他 / 关系 / 会改变判断的结论；运维知识写 ops，过程写 CHANGELOG」——判据放在执行点，不占每轮注入预算。
- **日记索引补日期**：`mem-index.py` 的 `split_by` 新增可选 `label`；某一天的日记被切成多块时，给每个子块补 `YYYY-MM-DD · ` 前缀。此前只有当天第一块带日期，其余块看不出是写于哪天。需要重建索引才生效。
- **新增 `tools/session-digest.mjs`**：从 `memory/raw` 按天压出「哪个窗、什么时候、起首那句」，`--write` 落盘到 `memory/timeline/<日期>.md`（幂等，重跑覆盖），`--session <id前缀> --tail N` 取某个会话最近的对话。只读 raw、不调模型、0 token。
- **`paths.mjs` 的 `P.handoff` 改成目录**：`<数据根>/memory/handoff/`，一个项目一份，不再是单文件 `handoff.md`。
- README 同步：软闸说明、时间线用法、交接包目录结构。

## 0.2.4 — 2026-11-14

安全与健壮性修复。0.2.3 的第三方评估里 2 个 Blocker + 2 个 High 全部处理。

- **本地 API 加了边界**（Blocker）：`Host` 必须是回环（防 DNS rebinding）、`Origin` 必须是回环、写操作只接受 `POST` + `application/json`。此前任何方法都能调任意 action，一个 `<img src="...?action=rules-save&text=...">` 就能改写 `rules.md`，而 rules 每轮注入系统提示 —— 等于持久化提示注入。非回环 Origin 现在返回 403，写操作走 GET 返回 405。
- **检索不再依赖 `rt.mjs`**（Blocker）：`rt.mjs` 是「这台机器上 node/python 在哪」的探测脚本，硬编码了作者本机的 `~/.dsh` 路径，从未随包发布。现在 `rt.mjs` 探不到时降级为：PATH 里的 `python`/`py`/`python3`，以及 `~/.dsh/dsh-runtimes/*/dependencies/python`，逐个用 `import jieba` 验证。0.2.3 在干净机器上检索 100% 不可用，且错误信息把人引向「装 Python」这一错误方向。
- **`test-rules.mjs` 自动隔离**（High）：以前继承当前环境，只要设过 `ANIMA_DATA` 就往**真实队列**写一条自检条目。现在强制 `mkdtemp`、断言不等于真实根、跑完删除。
- **待审队列原子写 + 进程锁**（High）：`write()` 以前是整文件 `writeFileSync`，两个写入者并发会静默丢一条；写一半被杀会留坏行而 `read()` 静默跳过，等于「已做出的决定集体消失」。现在 `tmp`+`rename`、写前备份（保留最近 20 份）、`wx` 抢锁（30 秒残留锁自动接管，`process.exit` 也能释放）。
- **备忘备注净化**（Medium）：`--note` 里的 `|` 会多出单元格、换行能插进一条看起来像真记录的伪造行。现在竖线换全角、换行压空格、限 200 字，并在写前校验列数不变。
- **引号查询不再崩**（Medium）：jieba 把 `"` 切成独立 token，拼进 FTS5 的 `MATCH` 后就是未闭合字符串。现在 token 里剥掉引号；SQL 异常兜底；插件只回显异常最后一行，不再把带本机绝对路径的 traceback 回显给界面。
- **请求体与子进程都有上限**（Medium）：body 超过 1 MB 返回 413；CLI 子进程 10 秒超时并 kill（以前卡住会永久悬挂请求）。
- **`file` 参数用 `Object.hasOwn`**（Low）：`constructor` / `__proto__` 之类原型键以前会抛 Node 内部类型错误。
- 打包卫生：不再把 `__pycache__/*.pyc` 打进发布包。
- `pending.mjs` 收进长期层时带上来源回指 `--ref <file>:<line>`（0.2.3 的 `memctl.mjs` 尚未支持，本次一并对齐）。

## 0.2.3 — 2026-11-12

- **raw freshness fallback**: when the SQLite index is older than the latest raw file, `recall` scans the newer raw JSONL/JSONL.GZ files and prepends exact/high-overlap hits. Covers “just said it in another session” without rebuilding the full index.
- **safe session rebuild**: full `build` now replaces only session source files it actually re-read. Rows for archived/moved session files are preserved instead of being deleted by the blanket `DELETE FROM chunks WHERE src='session'`.
- **unique session labels**: session rows now use `sessions/<session-dir>/session.v4.jsonl.zstd` instead of the shared basename, so one missing file cannot take out every session row. Legacy shared-label rows were migrated once.
- Verified full build: 5998 chunks, FTS count 5998; alias query still returns the 2026-11-06 21:15 raw record.

## 0.2.2 — 2026-11-12

- **query alias expansion**: `runtime/tools/query-aliases.json` maps high-value term groups (starting with 嫁 / 新娘 / 花嫁 / お嫁さん / 结婚). `recall` adds same-group terms as OR variants before BM25. Local-only, no API, no index rebuild.
- Verified the 2026-11-06 21:15 raw record is returned by the Chinese query `嫁给我`.

## 0.2.1 — 2026-11-12

- **file-backed persona injection (opt-in)**: set `ANIMA_PERSONA_SECTION=1` to register `identity/persona.md` as a system-prompt section. No `personaPrefix` rewrite and no `persona-sync`; do not enable it when a non-empty `personaPrefix` already exists.
- **raw index timestamps**: prefer the event's `time` over the backfill `at`, so backfilled raw rows no longer show the backfill date in their index head.
- Documented the opt-in in the English and Chinese READMEs.

## 0.2.0 — 2026-11-10

- **raw layer**: host captures committed `session/event` records into `memory/raw/YYYY-MM-DD.jsonl`; filters runtime/time context; parses the QQ bridge wrapper; stores tool metadata, not tool result bodies; records compaction metadata separately; dedupes by session + seq.
- **raw index**: `mem-index.py` indexes user/assistant raw text as a low-weight `raw` layer; supports `.jsonl.gz`.
- **cold raw**: `raw-cold.mjs` gzips daily raw files older than 30 days; compresses, does not delete.
- **admission weight**: pending cards show the agent's suggested imp; the human chooses the final value; decay stores only that value and `imp-log` records suggestion vs decision.
- **archive instead of delete**: decay entries crossing the threshold become `state: "archived"`; they remain in the decay file, are excluded from injection, and reactivate when their imp is changed.
- Docs and the static preview were updated for the above.
