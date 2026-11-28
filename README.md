# Anima Fovenda

![Anima Fovenda — a memory layer](docs/banner.jpg)

> **Shared as-is.** This is a personal tool published for reading and forking: **Issues are disabled and PRs are not reviewed.** If you need it to behave differently, fork it and change it.
>
> **Early release (0.2.x). Interfaces may change between minor versions.** Things that have moved recently: `memctl add` now needs `--by owner` or `--from-pending`, and `paths.mjs` exposes `P.handoff` as a directory. Read `CHANGELOG.md` before upgrading.

A memory-review console for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). One sidebar panel, six tabs: pending facts, persona snapshot diff, rules, decay/long-term memory, memo, and search.

中文安装说明：[README.zh-CN.md](README.zh-CN.md)

The plugin is deliberately **read-mostly**: memory files are written through the CLI, not by the browser. The rules file is the one editable text surface, with backups and mtime conflict detection.

**Any session can pick up any earlier topic** — not because it was stuffed into the context, but because it can be looked up: a skeleton per day, an index per word, conclusions in a shared layer. What carries over is **facts and reasons**; the mood of that day is not in there — read the diary for that.

## How it differs from other memory setups

Every row below comes from one goal: **keeping persona and memory continuous and correct** — not making the model remember more, but keeping *who remembers, what is remembered, and when it is forgotten* open to review and correction.

| Dimension | Usually | Here |
|---|---|---|
| Writing | auto-extract, auto-distill | **pending buffer**: the model only proposes; nothing reaches the hot layer until a human accepts it |
| Per-turn cost | auto-retrieve and inject one reference every turn | injects only persona / rules and a skeleton; details are pulled on demand (`recall`, `session-digest`) |
| Where it lives | vector DB / hosted service / one database | one file per kind: hot layer, long-term facts, verbatim quotes, ops notes, changelog — readable with `cat`, diffable, movable |
| Retrieval | embeddings (extra service, extra cost) | local SQLite FTS5 + jieba + per-layer weights — offline, 0 tokens |
| Granularity | branch-level / state-level (merge, freeze) | **entry-level**: reject one, reweight one |
| Growth | append-only, gets noisy | decay: important entries bottom out but never vanish; low ones age into an archive, and **archiving deletes nothing** |
| Observability | a state snapshot, if anything | six tabs act as a health dashboard: pending, hot layer, long-term, persona diff, search, memo |
| Side effects | written quietly in the background | one write path (`memctl`); every importance change logged to `imp-log.jsonl` and auditable |
| Dependencies | a pile of npm packages | zero npm dependencies; Python is needed only for the search layer |

### Trade-offs, and the levers they leave you

Every unusual choice above points at the same goal: **keeping persona and memory continuous and correct** — not letting the model run as fast as it can on its own. The price is less automation; what you buy is that **control never leaves your hands**.

- **The queue ignores provenance** (small talk and real decisions queue alike). That is deliberate: what matters is not *what enters the queue*, but **who decides where it goes** — you, or you and the agent together.
- **Decay is not in the system prompt.** It is a memory block pulled once a night, not injected every turn. So a badly written entry cannot contaminate every turn on the spot; when you spot something wrong in the console you can look, ask the agent to cross-check, and prune.
- **No in-window cutting**: after a topic switch the old material stays in context. Want it clean? Open a new window and use the handoff — an explicit action, not an automatic guess.
- **Mood stays out of the context.** Verbatim words live in `raw`, feelings live in the diary; neither is injected. First, because compressing a feeling into a label is already fabrication; second, because loading a pile of emotion into the context breaks judgement before it helps it. To restore how a day felt, read the diary — do not ask the model to guess.
- **Nobody at the desk, nothing in the hot layer.** That is the cost, and also the guarantee: nothing can slip past your judgement into the hot layer.

In one line: **automation traded for stability, levers kept for correction.** This is not "smarter memory" — it is memory you can audit and prune.

**An example**: one day an important entry is archived by mistake. A tier count in the routine check drops while the change log shows nothing — numbers that disagree are the lead. Follow the id, see the whole trail, restore from backup, add an assertion so it cannot recur. Black boxes fail too; they just do not tell you, and they do not hand you an id.

**License:** MIT · **Author:** 桜坂珠洲音 · **Package:** `anima-fovenda` · **API:** `/anima-fovenda/api`

- **Data root:** set with `ANIMA_DATA` or `ANIMA_PATHS`; the plugin does not guess a home directory.
- **Security:** read [SECURITY.md](SECURITY.md) first — the local API has **no token auth**.

## What is in this package

```
plugin/           DSH plugin (host + Web client + locale + icon)
runtime/          CLI tools and empty identity templates
preview/          static HTML mock; no backend, no real data
docs/             README banner (banner.jpg / social-preview.png)
unit-test.mjs     pure client tests
LICENSE
```

**Not included:** any real memory, diaries, persona, rules, memo, handoff notes, scheduled tasks, automatic backups, or the author's watch/inject flow. Those are deployment-specific. The pending queue also does not feed itself: an external agent or CLI must call `pending.mjs add`.

## Before you start

- **DSH 0.2.x** (Desktop or Web).
- **Node.js 20+** available as `node` in a terminal. Check with `node --version`. If DSH's bundled runtime is not on PATH, use its full `node.exe` path for the setup commands, or install Node 20+.
- Commands below are **Windows** (`cmd.exe`). On Linux/macOS, replace `xcopy`/`copy` with `cp -R` and use `export` instead of `setx`.
- **Search is optional:** it needs Python 3 + `jieba`; session indexing also needs `zstandard`. The other tabs work without them.
- Extract the zip. The **package root** is the folder containing `plugin/`, `runtime/`, `README.md`, and `package.json`.

## First-time install

Open a terminal at the package root. Replace `D:\anima-fovenda` and `D:\anima-data` with your own paths.

### 1. Create a data root

```bat
node runtime\tools\init.mjs D:\anima-data
xcopy runtime\tools\* D:\anima-data\tools\ /E /I /Y
copy runtime\memctl.mjs D:\anima-data\
```

`init.mjs` creates `memory/`, `identity/`, `MEMO.md` and `CHANGELOG.md`, and never overwrites an existing file.

It seeds two kinds of files: **structured templates** (`facts.md`, `self/self.md`, `self/voices.md`, `ops.md`, `MEMO.md`, the four `.jsonl` files) and **empty ones** (`identity/persona.md`, `identity/rules.md` — write your own). The package deliberately ships none of them; `init.mjs` is the single source of truth.

### Persona injection (optional)

**First, one thing that trips people up:** the **Persona tab always shows** `<data root>\identity\persona.md`. Having content there proves nothing about whether it is in the system prompt.

Three routes, pick one:

| Route | How | Who |
|---|---|---|
| ① `personaPrefix` | bake it into `cordis.patch.yml` → `system-prompt.personaPrefix` | you want it pinned in config |
| ② `ANIMA_PERSONA_SECTION=1` | the plugin registers `persona.md` as a system-prompt section, re-read every turn | **recommended default for third parties** |
| ③ neither | display only, never injected | you just want a place to keep it |

```bat
setx ANIMA_PERSONA_SECTION 1
```

Do not enable both ② and a non-empty ①: the persona would be injected twice.

### 2. Point the plugin at the data root

```bat
setx ANIMA_DATA "D:\anima-data"
```

Or point directly at the path resolver:

```bat
setx ANIMA_PATHS "D:\anima-data\tools\paths.mjs"
```

`setx` only affects new processes; restart DSH afterwards. If neither variable is set, the plugin refuses to start and prints the paths it tried.

### 3. Install the plugin

Use the DSH plugin manager and select this package's `plugin/` directory, or add it to the profile manually:

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

Then add the bundle patch in `cordis.patch.yml`:

```yaml
- insert:
    - id: anima-fovenda
      name: 'anima-fovenda'
```

Run `pnpm install` in the profile if you edited `package.json` by hand.

### 4. Restart and verify

The host half loads at module level: after changing `index.js`, restart DSH. Client changes only need a page refresh.

```bat
curl "http://127.0.0.1:<port>/anima-fovenda/api?action=state"
```

`{"ok":true,...}` means the plugin is mounted. If the plugin is not loaded, the API path returns 404.

### 5. First-run checklist

- Sidebar shows **Anima Fovenda**; click it.
- **Pending** shows `暂无` unless the queue already has entries.
- **Rules** is empty until you put text in `identity/rules.md`; an empty file means no injected rules.
- **Persona** may be empty until you put a persona in `identity/persona.md` and create a snapshot.
- **Memory / Memo** may be empty on a fresh data root; that is normal.
- There are **no scheduled tasks, automatic backups, or watch/inject flows** after install. That is expected.

### Troubleshooting

| Symptom | Check |
|---|---|
| Sidebar item missing | Did you fully restart DSH after adding the bundle? Is the plugin manager target `plugin/`? Does `plugin/package.json` have a BOM? |
| API returns 404 | Host half not loaded. Check DSH logs, the profile bundle list, and `ANIMA_DATA`. |
| `找不到 tools/paths.mjs` | `ANIMA_DATA` must point to the folder that contains `tools/paths.mjs`. Open a **new** terminal after `setx`. |
| Rules page empty | Normal: the identity templates are empty. Write `identity/rules.md`. |
| Search tab errors | Read the error text first: it lists which interpreters were tried. Install Python 3 + `jieba` (plus `zstandard` for session indexing). |
| Settings changed but DSH still uses old values | `setx` only affects new processes. Quit DSH completely and reopen it. |
| UI changes not visible | Client changes need a page refresh; `index.js` changes need a full DSH restart. |

## Tabs

| tab | What it does | Writes? |
|---|---|---|
| **Pending** | Review queue cards; accept into decay, reject, or route into facts / self / voices | Yes, via `pending.mjs` |
| **Rules** | Edit `identity/rules.md`; mtime conflict check, backup, atomic replace | Yes (config, not memory) |
| **Persona** | Diff the current persona against snapshots | No |
| **Memory** | Decay table (imp / clarity / archive days) + read-only facts / self / voices; archived entries stay on disk and are not injected | No |
| **Memo** | Read `MEMO.md`; change row status | Yes, via `memo.mjs` |
| **Search** | Full-text search over docs, decay, self, voices, and optional sessions | No |

## Raw capture

The host appends committed session events to `memory/raw/YYYY-MM-DD.jsonl`:

- user text (`source.kind === "user"`; runtime/time context is skipped)
- assistant text (text blocks only; tool/reasoning-only steps are skipped)
- tool call/result **metadata**, not tool result bodies
- compaction metadata in `memory/raw/compaction.jsonl` (shadowed ranges, summary length; not the summary text)

It is append-only and is never injected automatically. Set `ANIMA_RAW=0` to disable capture. Compaction-aware summaries should read raw up to a checkpoint; they must not overwrite it.

`mem-index.py` indexes raw user/assistant text as a low-weight `raw` layer for search; tool metadata is not indexed. After 30 days, `node runtime/tools/raw-cold.mjs --days 30` gzips old daily files (it compresses, it does not delete content). Neither step is scheduled by the plugin.

## Pending queue

The plugin provides the queue and the accept/reject/route actions. It does **not** decide when to add entries. A typical agent policy is:

- the user says "remember / from now on / don't / rule" but does not say which layer;
- a conclusion looks useful later, but it is unclear whether it belongs in facts, self, or voices;
- the agent keeps repeating a mistake and has not decided what rule to write.

Entries need a source (`--src`), and accept/reject is a human decision. Daily caps and timing are deployment conventions, not plugin defaults.

When accepting into decay, the card shows the agent's **suggested imp**. You choose the final imp; the decay record stores only that final value. The suggestion and the decision are both written to `imp-log.jsonl` for calibration.

### 0.2.5: `memctl add` has a soft gate

The decay layer is the *hot* layer (injected into every turn), so 0.2.5 gates writes to it:

```bat
node memctl.mjs add "…"                      -> rejected (exit 1), prints the two ways below
node memctl.mjs add "…" --by owner           -> allowed: you explicitly said "this one matters"
node tools\pending.mjs add "…" --src "where" -> queue for review; accept adds --from-pending for you
```

`pending.mjs` passes `--from-pending` automatically on both accept and route, so the normal queue flow is unaffected. The gate only blocks "bypass the queue and write decay directly".

## Daily timeline (0.2.5)

`tools/session-digest.mjs` distills `memory/raw` into "which window, when, and its opening line". No model call, 0 tokens:

```bat
node D:\anima-data\tools\session-digest.mjs                        :: print to stdout
node D:\anima-data\tools\session-digest.mjs --write                :: write memory\timeline\<date>.md (idempotent)
node D:\anima-data\tools\session-digest.mjs --session <prefix> --tail 5   :: last N turns of one session
```

It is an **index, not a diary**: facts only (window / time / opening line), no judgements. Good candidate for a nightly job so "what happened in the other windows today" never becomes a blank.

## Search (optional)

**A fresh install has an empty index.** `init.mjs` creates directories only; `identity/` ships as empty templates; `raw/` starts filling only after the plugin has been running. So search returns nothing until there is content — that is not a bug. Check with:

```bat
python D:\anima-data\tools\mem-index.py stats
```

- "index not built" → run `build --docs` once
- raw chunks but 0 doc chunks → normal: you can search conversation text, but not "facts about him" (templates are empty)
- 0 chunks → confirm `memory\raw` has `.jsonl` files, then rebuild

Search needs Python 3 plus `jieba`; session indexing additionally needs `zstandard`. The plugin does not depend on `rt.mjs`: it tries `python` / `py` / `python3` on PATH, then `%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\python`, validating each with `import jieba`.

After install the tools live under the **data root**, not in the package folder:

```bat
python D:\anima-data\tools\mem-index.py build --docs
python D:\anima-data\tools\mem-index.py recall "query" --k 5
```

Session files are auto-discovered under `%USERPROFILE%\.dsh\sessions`. Set `ANIMA_SESSIONS` to a directory or a single `session.v4.jsonl.zstd` to override. If Python or the packages are missing, only the Search tab fails; the other tabs still work.

## Scheduled maintenance (backup + reindex)

Two periodic jobs: **backup** and **reindex**.

**Run them at the end of the DSH scheduled task you already have** (the one that reads the diary and composes the push). The chain is simple:

> DSH offline → no new content → no incremental backup → no separate scheduler needed;
> and whatever an OS job produces still has to be confirmed by DSH or a human.

So a separate scheduler for mechanical steps is redundant. **An OS cron/scheduled task only makes sense if you want backups to exist independently of DSH** (e.g. syncing the data root to another machine on a timer) — and even then, with DSH offline it just copies the same bytes.

**What actually matters is catching "ran but did nothing"** — we had a sync command writing to a dead path for two weeks before anyone noticed. Whoever runs it, report numbers against thresholds:

- backup: file count / total size; more than 5% smaller than last time → flag
- restore kit: size; missing or < 1 MB → fail
- index: `chunks_total`; 0 → "nothing to index"
- timeline: number of windows; 0 → flag

### Backup

- Backup = copy the **whole data root**; the only thing you can exclude is `memory\index\` (rebuildable, tens of MB)
- Must back up (not rebuildable): `memory\raw` (verbatim conversation log), `decay.jsonl`, `full.jsonl`, `pending-facts.jsonl`, `facts.md`, `self\`, `identity\`, `MEMO.md`, `CHANGELOG.md`
- **Privacy:** `raw` is verbatim and unredacted. Treat backups as sensitive.
- Restore: copy back → run `init.mjs` (idempotent, never overwrites) → rebuild the index

```bat
:: Optional — only if you want backups to exist independently of DSH
schtasks /create /tn "anima-backup" /tr "robocopy D:\anima-data C:\backup\anima-data /MIR /XD D:\anima-data\memory\index" /sc daily /st 03:00
```

```bash
# Linux / macOS
0 3 * * *  rsync -a --exclude 'memory/index' /path/anima-data/ /backup/anima-data/
```

### Reindex

- The index does **not** update itself, and raw keeps growing
- Recent days are still searchable without a rebuild (`recall` falls back to scanning the newest raw files), but long history needs a rebuild
- Append it to your existing DSH scheduled task (run once before wrapping up)

```bat
python D:\anima-data\tools\mem-index.py build --docs
```

If you do use an OS scheduler: its environment differs from your shell — PATH usually lacks node/python, so use absolute paths; point `PYTHONPATH` at `tools\pylibs` and set `PYTHONIOENCODING=utf-8`.

Scheduled tasks have a different environment: PATH often lacks node/python, so use absolute paths; set `PYTHONPATH` to `tools\pylibs` and `PYTHONIOENCODING=utf-8`.

## Let the machine keep watch (optional)

`tools\check-open.mjs` turns "an error was reported" into **state**. A failing check is registered; every later run mentions it again; a passing check **closes it automatically** — nobody has to remember to delete it, because "waiting for someone to delete" and "waiting for someone to read the report" are the same dependency.

```bat
node D:\anima-data\tools\check-open.mjs          :: run, print what is still open
node D:\anima-data\tools\check-open.mjs list     :: just show the ledger
node D:\anima-data\tools\check-open.mjs --json   :: for scheduled jobs
```

Four built-in mechanical checks (no model judgement needed):

| key | assertion |
|---|---|
| `imp_ge4_archived` | no entry with `imp>=4` sits in the archive |
| `decay_subset_full` | every `decay` entry exists in `full` |
| `index_present` | the index file exists and is not an empty shell (< 8 KB means empty) |
| `pending_dup` | the pending queue holds no duplicated text |

The ledger is `memory\open-issues.jsonl` (key / first seen / times seen / how to fix); closed items are archived to `open-issues-closed.jsonl`. Anything open for more than 3 days is flagged.

Problems a machine cannot judge can be registered by hand:

```bat
node D:\anima-data\tools\check-open.mjs add --key my_check --what "symptom" --how "how to fix"
node D:\anima-data\tools\check-open.mjs close my_check --why "fixed"
```

**Worth running as step 0 of your scheduled job**: run it first, copy the `open` array into that day's "anomalies" section. If nobody reads the report, nothing is lost — it keeps repeating until fixed.

## Security

- The API listens on `127.0.0.1` only and adds no CORS headers.
- **Request boundary (0.2.4+):** `Host` and `Origin` must be loopback (this blocks DNS rebinding and "any web page can rewrite rules with a GET"); writes accept only `POST` + `application/json`, and `GET` is read-only. A non-loopback Origin gets 403; a write action over GET gets 405.
- There is still **no token authentication**: another local process can call the read endpoints, and can forge a loopback Origin for writes. Do not expose the port to a public network, and do not run untrusted processes on the same machine.
- `file` accepts only a whitelist of keys; the browser never gets arbitrary path access.
- Writes go through `pending.mjs`, `memo.mjs`, or the guarded rules endpoint. The rules endpoint checks mtime and writes a `.bak` before an atomic replace; the pending queue uses a process lock, atomic writes, and pre-write backups.
- Request bodies are capped at 1 MB; CLI subprocesses time out after 10 seconds.

## Tests

```bat
node unit-test.mjs
node runtime\tools\test-rules.mjs
```

`test-rules.mjs` creates its own isolated data root in the system temp directory and deletes it afterwards, so it does **not** write to the real queue (as of 0.2.4; 0.2.3 and earlier appended a `src: test-rules.mjs 自动写入` entry). API smoke/e2e tests require a running DSH instance and a populated data root; they are not included as a promise that a bare checkout is enough.

## Handing this to someone else

The package itself contains no real data and **no template files at all** — `identity/` and the memory stubs are created by `init.mjs`. If you pack or zip from **your own deployment directory**, exclude:

- `memory/raw/` — captures every user and assistant message verbatim, with no redaction;
- the rest of `memory/` (`decay.jsonl`, `facts.md`, `self/`, `daily/`) and `MEMO.md`;
- `identity/persona.md` and `identity/rules.md` — your written versions *are* your prompt;
- `*.bak-*`, `memory/.queue-baks/`, `memory/.pre-route/` — copies, same verbatim text;
- credential files such as `~/.dsh/.secrets.json` (outside this package anyway — just do not drag them along).

What the other person should get is `plugin/` + `runtime/` + `preview/` + the docs, and then they build their own data root with "First-time install" above.

## Preview

Open `preview/ui-preview.html` in a browser. It is a static visual mock: no API, no data, no writes. Use `?tab=memory&theme=dark` to jump to a view.

## License

MIT. See `LICENSE`.
