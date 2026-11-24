#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""记忆索引（BM25 / FTS5 + jieba）—— 文档 + 会话，一个库一个命令

为什么要它：ops.md 35K、私人日记 109K，整本读太贵，于是"写了但用不上"。
索引把它们从 7 万 token 降到 600 token，让它们真的能被用。

用法：
    python mem-index.py build            # 增量重建（文档 + 会话）
    python mem-index.py build --docs     # 只重建文档
    python mem-index.py build --sessions # 只重建会话
    python mem-index.py recall "问题" --k 5
    python mem-index.py stats

分层与切法（对应 docs/MEMORY-PLAN.md）：
    ops.md         → 按 `##` 小节
    CHANGELOG.md   → 按 `## 日期` 下的 `###`
    MEMO.md        → 按 `##` 小节
    日记            → 按 `## 2026-MM-DD` 一天一块
    daily/*.md     → 一天一块
    docs / TOOL-RULES / AGENT-nightly → 按 `##` 小节
    sessions       → 按回合（见 session_turns）
    self/voices    → 按 `##` 小节（2026-11-07 补：这两份之前根本没进索引，等于搜不到）

不索引：facts.md / role.md / handoff.md（<5K，整本读更划算）
"""
import os, re, sys, json, glob, sqlite3, argparse, datetime, shutil, subprocess, gzip

# 2026-11-01：依赖装在 tools/pylibs（不是 runtime 的 site-packages）——
# runtime 被重装过一次，pip 装的东西全丢了（见 ops「运行时被重装」）。
_PYLIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pylibs")
if os.path.isdir(_PYLIB) and _PYLIB not in sys.path:
    sys.path.insert(0, _PYLIB)

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
DSH = os.path.join(HOME, ".dsh")
W = os.path.dirname(HERE)          # <DATA>（tools 的上一层）
DB = os.path.join(W, "memory", "index", "mem.db")
RAW_DIR = os.path.join(W, "memory", "raw")
ALIAS_FILE = os.path.join(HERE, "query-aliases.json")

# 2026-11-08：路径的真相在 tools/paths.mjs。能用 node 问它就别在这里写第二份解析逻辑。
# 问不到（比如没装 node）才退回上面那三行默认值 —— 那是 paths.mjs 的同一个约定。
def _paths_from_node():
    here = os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(here, "paths.mjs")
    if not os.path.isfile(script):
        return None
    node = shutil.which("node")
    if not node:
        import glob
        for cand in glob.glob(os.path.join(HOME, ".dsh", "dsh-runtimes", "*", "dependencies", "node", "bin", "node.exe")):
            node = cand
            break
    if not node:
        return None
    try:
        out = subprocess.run([node, script, "--json"], capture_output=True, timeout=20)
        if out.returncode == 0:
            return json.loads(out.stdout.decode("utf-8", "replace"))
    except Exception:
        return None
    return None


_pt = _paths_from_node()
if _pt:
    HOME = _pt.get("HOME", HOME)
    DSH = _pt.get("DSH", DSH)
    W = _pt.get("DATA", W)
    DB = _pt.get("P", {}).get("index", DB)

CHUNK_MAX = 1200
CHUNK_MIN = 60

try:
    import jieba
    jieba.setLogLevel(60)
except ImportError:
    sys.exit("需要 jieba：python -m pip install jieba")

# ── 文档源：(路径, 分解正则, 层) ─────────────────────────────
DOCS = [
    (os.path.join(W, "memory", "ops.md"),            r"^##+ ",              "ops"),
    # 2026-11-01 拆分：记录层单独一份，不索引就等于「搬走了又搜不到」
    (os.path.join(W, "memory", "ops-log.md"),        r"^##+ ",              "ops-log"),
    (os.path.join(W, "CHANGELOG.md"),                r"^### ",              "changelog"),
    (os.path.join(W, "MEMO.md"),                     r"^##+ ",              "memo"),
    (os.path.join(W, "TOOL-RULES.md"),               r"^##+ ",              "rules"),
    # 2026-11-07：self / voices 之前完全不在索引里 —— 教训和原话都搜不到
    (os.path.join(W, "memory", "self", "self.md"),   r"^##+ ",              "self"),
    (os.path.join(W, "memory", "self", "voices.md"), r"^##+ ",              "voices"),
    (os.path.join(W, "AGENT-nightly.md"),            r"^##+ ",              "flow"),
    (os.path.join(W, "docs", "MEMORY-PLAN.md"),      r"^##+ ",              "docs"),
]

# 日记是可选目录：有几本索引几本，不假设文件名，也不假设一定存在。
DIARY_DIR = os.path.join(W, "memory", "diary")
if os.path.isdir(DIARY_DIR):
    for _name in sorted(os.listdir(DIARY_DIR)):
        if _name.endswith(".md"):
            DOCS.append((os.path.join(DIARY_DIR, _name), r"^## \d{4}-\d{2}-\d{2}", "diary"))

DAILY_GLOB = os.path.join(W, "memory", "daily", "*.md")

# 会话索引是可选输入：默认自动找 DSH 的 session.v4.jsonl.zstd；
# 也可以用 ANIMA_SESSIONS 指向一个目录（递归找）或单个文件。
SESSION_FILES = []
_env_sessions = os.environ.get("ANIMA_SESSIONS")
if _env_sessions:
    _p = os.path.abspath(_env_sessions)
    if os.path.isfile(_p):
        SESSION_FILES = [_p]
    elif os.path.isdir(_p):
        SESSION_FILES = sorted(
            glob.glob(os.path.join(_p, "**", "session.v4.jsonl.zstd"), recursive=True),
            key=os.path.getmtime, reverse=True)
else:
    _sessions_root = os.path.join(DSH, "sessions")
    if os.path.isdir(_sessions_root):
        SESSION_FILES = sorted(
            glob.glob(os.path.join(_sessions_root, "*", "*", "session.v4.jsonl.zstd")),
            key=os.path.getmtime, reverse=True)


def tokenize(t):
    return " ".join(x for x in jieba.cut(t or "") if x.strip())


def load_aliases():
    """查询扩展别名组。文件坏了/不存在就退回纯 BM25，不影响 recall。"""
    try:
        with open(ALIAS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        groups = data.get("groups", []) if isinstance(data, dict) else data
        out = []
        for g in groups:
            terms = [str(t).strip() for t in g if str(t).strip()]
            if len(terms) >= 2:
                out.append(terms)
        return out
    except Exception:
        return []


def expand_query(q):
    """命中别名组任一成员时，把同组其他成员加入 OR 查询；纯本地、无 API。"""
    ql = (q or "").casefold()
    add = []
    for group in load_aliases():
        if any(t.casefold() in ql for t in group):
            for t in group:
                if t.casefold() not in ql and t not in add:
                    add.append(t)
    if not add:
        return q
    return q + " " + " ".join(add[:32])


def split_by(text, pat, label=None):
    """按正则切块；标题行归属它下面那块。

    label：可选正则（带捕获组）。某一块被切成多块时，把「归属标记」补到
    每个子块开头，避免子块看不出是哪天——日记就是这么用的（2026-11-24 修 #71）。
    """
    lines = text.split("\n")
    rx = re.compile(pat)
    lrx = re.compile(label) if label else None
    blocks, cur = [], []
    for ln in lines:
        if rx.match(ln) and cur:
            blocks.append("\n".join(cur))
            cur = [ln]
        else:
            cur.append(ln)
    if cur:
        blocks.append("\n".join(cur))
    out = []
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        heading, prefix = "", ""
        if lrx:
            m = lrx.match(b.split("\n", 1)[0])
            if m:
                heading = m.group(0)
                prefix = str(m.group(1) if m.groups() else heading) + " · "
        if len(b) <= CHUNK_MAX:
            pieces = [b]
        else:                     # 太长再按空行切
            pieces, buf = [], ""
            for para in b.split("\n"):
                if len(buf) + len(para) + 1 > CHUNK_MAX and buf:
                    pieces.append(buf); buf = para
                else:
                    buf = (buf + "\n" + para) if buf else para
            if buf:
                pieces.append(buf)
        for p in pieces:
            if prefix and heading and not p.startswith(heading):
                p = prefix + p
            out.append(p)
    return [x for x in out if len(x) >= CHUNK_MIN]


def doc_chunks():
    rows = []
    for path, pat, layer in DOCS:
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf-8", errors="replace").read()
        # 日记：一天一块但常被切，给子块补上 `YYYY-MM-DD · ` 前缀
        lab = r"^## (\d{4}-\d{2}-\d{2})" if layer == "diary" else None
        for blk in split_by(text, pat, lab):
            head = blk.split("\n", 1)[0][:80]
            rows.append(("doc", layer, os.path.relpath(path, HOME), head, blk, ""))
    for path in glob.glob(DAILY_GLOB):
        text = open(path, encoding="utf-8", errors="replace").read()
        day = os.path.basename(path)[:-3]
        for blk in split_by(text, r"^#+ "):
            rows.append(("doc", "daily", os.path.relpath(path, HOME), day, blk, ""))
    return rows


def decay_chunks():
    """衰减层的每条记忆单独一块（重要度 + 日期进正文，方便检索时判断分量）。"""
    p = os.path.join(W, "memory", "decay.jsonl")
    if not os.path.exists(p):
        return []
    rows = []
    for line in open(p, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        text = f"[imp{r.get('imp')}] {r.get('at','')[:10]} {r.get('text','')}"
        rows.append(("decay", "decay", "memory/decay.jsonl", r.get("at", "")[:10], text, ""))
    return rows


def raw_stamp(r):
    if r.get("time"):
        try:
            return datetime.datetime.fromtimestamp(float(r["time"]) / 1000).strftime("%Y-%m-%d %H:%M")
        except Exception:
            pass
    return str(r.get("at") or "")[:16]


def raw_chunks():
    """原始层：只索引 user/assistant 的 text；tool/compaction 元数据不入全文索引。"""
    raw_dir = os.path.join(W, "memory", "raw")
    if not os.path.isdir(raw_dir):
        return []
    rows = []
    for name in sorted(os.listdir(raw_dir)):
        if not (name.endswith(".jsonl") or name.endswith(".jsonl.gz")):
            continue
        path = os.path.join(raw_dir, name)
        opener = gzip.open if name.endswith(".gz") else open
        try:
            with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip().lstrip("\ufeff")
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    kind = r.get("kind")
                    if kind not in ("user", "assistant"):
                        continue
                    text = str(r.get("text") or "").strip()
                    if len(text) < 2:
                        continue
                    stamp = raw_stamp(r)
                    session = str(r.get("session") or "")[:8]
                    source = str(r.get("source") or "")
                    head = (kind + " · " + stamp[:16] + ((" · " + session) if session else "")).strip()
                    body = "[" + kind + ((" · " + source) if source else "") + "] " + text
                    rows.append(("raw", "raw", "memory/raw/" + name, head, body,
                                 tokenize(text) if kind == "user" else ""))
        except Exception:
            continue
    return rows


def session_turns(zst_path):
    import zstandard, io
    d = zstandard.ZstdDecompressor()
    NOISE = ("Current runtime context", "Time sampled while preparing", "<system-reminder>",
             "［身份］", "[身份]")
    turns, cur = [], None
    with open(zst_path, "rb") as fh:
        rd = d.stream_reader(fh)
        txt = io.TextIOWrapper(rd, encoding="utf-8", errors="replace")
        for line in txt:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            t = ev.get("type")
            data = ev.get("data") or {}
            if t == "user/message":
                if (data.get("source") or {}).get("kind") != "user":
                    continue
                text = "\n".join(b.get("text", "") for b in (data.get("content") or [])
                                 if isinstance(b, dict) and b.get("type") == "text").strip()
                if not text or any(text.startswith(p) for p in NOISE):
                    continue
                cur = {"ts": ev.get("time"), "user": text, "assistant": []}
                turns.append(cur)
            elif t == "assistant/message" and cur is not None:
                text = "\n".join(b.get("text", "") for b in ((data.get("message") or {}).get("content") or [])
                                 if isinstance(b, dict) and b.get("type") == "text").strip()
                if text:
                    cur["assistant"].append(text)
    return turns


def session_chunks():
    rows = []
    for zst_path in SESSION_FILES:
        if not os.path.exists(zst_path):
            continue
        label = "sessions/" + os.path.basename(os.path.dirname(zst_path)) + "/" + os.path.basename(zst_path)
        try:
            turns = session_turns(zst_path)
        except ImportError:
            return []          # 没装 zstandard：跳过会话，文档/衰减仍可索引
        for t in turns:
            body = "【用户】" + t["user"]
            if t["assistant"]:
                body += "\n【我】" + "\n".join(t["assistant"])
            ts = t["ts"]
            stamp = datetime.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M") if ts else ""
            for blk in split_by(body, r"^【用户】"):
                rows.append(("session", "session", label, stamp, blk, tokenize(t["user"])))
    return rows


def build(do_docs=True, do_sessions=True):
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    con = sqlite3.connect(DB)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS chunks(user_tokens TEXT,
            id INTEGER PRIMARY KEY, src TEXT, layer TEXT, path TEXT, head TEXT, body TEXT, tokens TEXT
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(tokens, user_tokens, content='chunks', content_rowid='id');
    """)
    if do_docs:
        con.execute("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE src IN ('doc','raw'))")
        con.execute("DELETE FROM chunks WHERE src IN ('doc','decay','raw')")
    rows = []
    if do_docs:
        rows += doc_chunks()
    if do_docs:
        rows += decay_chunks()
    if do_docs:
        rows += raw_chunks()
    if do_sessions:
        rows += session_chunks()
    # 只替换“这次确实读到的” session 文件；归档/移走的旧文件保留旧行，避免 full build 打穿索引。
    if do_sessions:
        rebuilt_labels = sorted({row[2] for row in rows if row[0] == "session"})
        for label in rebuilt_labels:
            con.execute("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE src='session' AND path=?)", (label,))
            con.execute("DELETE FROM chunks WHERE src='session' AND path=?", (label,))
    max_id = con.execute("SELECT COALESCE(MAX(id), 0) FROM chunks").fetchone()[0]
    con.executemany(
        "INSERT INTO chunks(src,layer,path,head,body,tokens,user_tokens) VALUES (?,?,?,?,?,?,?)",
        [(s, l, p, h, b, tokenize(b), utok) for (s, l, p, h, b, utok) in rows])
    # 只把这次新增的 rowid 灌进 FTS；保留下来的旧 session 行已有 FTS，不能全表重灌。
    con.execute("INSERT INTO chunks_fts(rowid, tokens, user_tokens) SELECT id, tokens, user_tokens FROM chunks WHERE id > ?", (max_id,))
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    con.close()
    print(json.dumps({"chunks_total": n, "added": len(rows), "db": DB}, ensure_ascii=False))
    # 2026-11-24：0 块是最常见的误判来源——库和表都建出来了，但里面什么都没有，
    # 界面搜什么都「没命中」。这里必须说清楚，不然用户以为功能坏了。
    if n == 0:
        print("警告：索引里 0 块。没有任何可索引内容——先确认 memory/raw 下有 .jsonl"
              "（插件跑起来才会产生），或 identity / facts / MEMO 里有文字，再重建。")


def index_stale():
    if not os.path.exists(DB):
        return True
    db_m = os.path.getmtime(DB)
    if not os.path.isdir(RAW_DIR):
        return False
    for name in os.listdir(RAW_DIR):
        if name.endswith(".jsonl") or name.endswith(".jsonl.gz"):
            try:
                if os.path.getmtime(os.path.join(RAW_DIR, name)) > db_m:
                    return True
            except OSError:
                continue
    return False


def raw_recent(q, k=3):
    """索引落后时，扫 raw 里比索引新的文件；只补最近命中的原话。"""
    if not os.path.isdir(RAW_DIR) or not os.path.exists(DB):
        return []
    db_m = os.path.getmtime(DB)
    qt = set(x for x in jieba.cut(expand_query(q)) if x.strip())
    if not qt:
        return []
    cands = []
    for name in sorted(os.listdir(RAW_DIR)):
        if not (name.endswith(".jsonl") or name.endswith(".jsonl.gz")):
            continue
        path = os.path.join(RAW_DIR, name)
        try:
            if os.path.getmtime(path) <= db_m:
                continue
        except OSError:
            continue
        opener = gzip.open if name.endswith(".gz") else open
        try:
            with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip().lstrip("\ufeff")
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    kind = r.get("kind")
                    if kind not in ("user", "assistant"):
                        continue
                    text = str(r.get("text") or "").strip()
                    if len(text) < 2:
                        continue
                    rt = set(x for x in jieba.cut(text) if x.strip())
                    hits = len(qt & rt)
                    if not hits:
                        continue
                    exact = bool(q.strip() and q.strip() in text)
                    try:
                        ts = float(r.get("time") or 0)
                    except Exception:
                        ts = 0
                    cands.append((hits, exact, ts, name, kind, r, text))
        except Exception:
            continue
    cands.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    exact_cands = [c for c in cands if c[1]]
    if exact_cands:
        cands = exact_cands
    out = []
    for hits, exact, ts, name, kind, r, text in cands[:max(1, min(2 if not exact_cands else 1, k))]:
        stamp = raw_stamp(r)
        session = str(r.get("session") or "")[:8]
        source = str(r.get("source") or "")
        head = (kind + " · " + stamp[:16] + ((" · " + session) if session else "")).strip()
        body = "[" + kind + ((" · " + source) if source else "") + "] " + text
        out.append({
            "src": "raw", "layer": "raw", "path": "memory/raw/" + name,
            "head": head, "score": -1.0, "score_raw": -1.0,
            "snippet": body.replace("\n", " ")[:180],
        })
    return out


def recall(q, k=5):
    # 2026-11-24：三种「查不到」必须分开说，否则界面上全是「没命中」。
    #   ① 索引没建  ② 建了但 0 块  ③ 有内容但真没命中（只有这种该安静）
    # 消息走 stdout：插件把 stdout/stderr 合并后取最后一行，混着发会取到 "[]"。
    if not os.path.exists(DB):
        print("[]")
        print("索引还没建：先跑 mem-index.py build --docs")
        return
    con = sqlite3.connect(DB)
    try:
        total = con.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    except sqlite3.Error:
        con.close()
        print("[]")
        print("索引文件在，但里面没有表：先跑 mem-index.py build --docs")
        return
    if total == 0:
        con.close()
        print("[]")
        print("索引是空的（0 块）：先确认 memory/raw 或文档里有过内容，再跑 build --docs")
        return
    toks = [x for x in jieba.cut(expand_query(q)) if x.strip()]
    toks = list(dict.fromkeys(toks))
    if not toks:
        print("[]")
        print("空查询", file=sys.stderr)
        return
    # 2026-11-14：jieba 会把 `"` 切成独立 token，而 FTS5 的 MATCH 语法里双引号是字符串
    # 定界符 —— 拼成 `"""` 就是「未闭合字符串」，带引号的原话直接崩（还回显 traceback）。
    # 引号对检索没有意义，直接剥掉；剥空了就跳过这个 token。
    clean = []
    for t in toks:
        t2 = t.replace('"', '').strip()
        if t2:
            clean.append(t2)
    if not clean:
        print("[]"); return
    match = " OR ".join('"' + t.replace('"', '""') + '"' for t in clean)
    # 2026-11-07：加层权重。bm25 是负数（越负越相关），所以 ×1.3 是提权、×0.95 是压后。
    # 为什么加：日记 110 块、会话 474 块，体量大的层关键词密度高，会把 voices / self / rules
    # 这些"规范层"挤到第 2-3 位；而查"他的原话 / 我犯过的错"时，规范层才是权威。
    sql = """SELECT c.src, c.layer, c.path, c.head, c.body,
                    bm25(chunks_fts, 1.0, 3.0) AS s,
                    bm25(chunks_fts, 1.0, 3.0) * CASE c.layer
                        WHEN 'voices' THEN 1.3 WHEN 'self' THEN 1.3 WHEN 'rules' THEN 1.3
                        WHEN 'raw' THEN 0.85
                        WHEN 'diary' THEN 0.95 WHEN 'session' THEN 0.95
                        ELSE 1.0 END AS ws
             FROM chunks_fts f JOIN chunks c ON c.id=f.rowid
             WHERE chunks_fts MATCH ?
             ORDER BY ws
             LIMIT ?"""
    try:
        rows = con.execute(sql, (match, k)).fetchall()
    except sqlite3.Error as e:
        # 兜底：万一还有别的字符把语法弄坏，别把 traceback 丢给上层（那里面带本机绝对路径）
        con.close()
        print(json.dumps([], ensure_ascii=False))
        print("检索语法被拒：" + str(e), file=sys.stderr)
        return
    con.close()
    # score 是加权后的有效分（跟排序一致）；score_raw 是原始 bm25，用来判断"到底像不像"
    out = [{"src": r[0], "layer": r[1], "path": r[2], "head": r[3],
            "score": round(r[6], 2), "score_raw": round(r[5], 2),
            "snippet": r[4].replace("\n", " ")[:180]} for r in rows]
    # 索引比 raw 旧时，补扫最近 raw；只在这种“刚说完”的窗口里生效。
    if index_stale():
        extra = raw_recent(q, min(3, k))
        if extra:
            seen = {(r["path"], r["head"]) for r in out}
            out = [r for r in extra if (r["path"], r["head"]) not in seen] + out
            out = out[:k]
    print(json.dumps(out, ensure_ascii=False, indent=1))


def stats():
    if not os.path.exists(DB):
        print("索引还没建：先跑 mem-index.py build --docs")
        return
    con = sqlite3.connect(DB)
    try:
        rows = con.execute("SELECT src, layer, COUNT(*), SUM(LENGTH(body)) FROM chunks GROUP BY src, layer ORDER BY src, layer").fetchall()
        tot = con.execute("SELECT COUNT(*), SUM(LENGTH(body)) FROM chunks").fetchone()
    except sqlite3.Error:
        con.close()
        print("索引文件在，但里面没有表：先跑 mem-index.py build --docs")
        return
    for src, layer, n, chars in rows:
        print(f"{src:8} {layer:10} {n:5} 块  {chars or 0:8} 字符")
    print(f"合计 {tot[0]} 块 / {tot[1] or 0} 字符 / {round(os.path.getsize(DB)/1048576,2)} MB")
    # 2026-11-24：新装最常见困惑——只有 raw 有块，文档层全是空模板。
    by_layer = {layer: n for _src, layer, n, _c in rows}
    raw_n = by_layer.get("raw", 0)
    doc_n = sum(n for layer, n in by_layer.items() if layer not in ("raw", "session", "decay", "diary", "daily"))
    if raw_n and not doc_n:
        print("提示：只有 raw 层有内容。检索能搜到对话原话，但文档层是空的（identity / facts / MEMO 还是模板）。")
    if tot[0] == 0:
        print("提示：索引是空的。先确认 memory/raw 或文档里有过内容，再跑 build --docs。")
    con.close()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--docs", action="store_true")
    b.add_argument("--sessions", action="store_true")
    r = sub.add_parser("recall"); r.add_argument("query"); r.add_argument("--k", type=int, default=5)
    sub.add_parser("stats")
    a = ap.parse_args()
    if a.cmd == "build":
        only_docs = a.docs and not a.sessions
        only_sess = a.sessions and not a.docs
        build(do_docs=not only_sess, do_sessions=not only_docs)
    elif a.cmd == "recall":
        recall(a.query, a.k)
    else:
        stats()


if __name__ == "__main__":
    main()
