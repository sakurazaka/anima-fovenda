/**
 * Anima Fovenda（记忆审阅台）· Host 半边
 *
 * 做三件事：
 *   1. 读数据根里的记忆 / persona，组装成 JSON 给页面
 *   2. 收/扔时 spawn `node tools/pending.mjs accept|reject`（不直接写文件，守住单一写入口）
 *   3. 把 <数据根>/identity/rules.md 作为动态 systemPrompt section 注册进去 —— 每次组装提示时读盘，
 *      所以改纪律只要改那个文件，下一条消息就生效（不用同步、不用重启、不碰 YAML）
 *
 * 页面在 client.js，走 `main` + `sidebar.panellist` 两个槽位。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const name = 'anima-fovenda'
export const inject = ['fs', 'webServer', 'systemPrompt']

// 路径的真相在 tools/paths.mjs。插件不再自己拼字符串，也不硬编码用户目录。
// 只认两个环境变量：ANIMA_PATHS（直接指到 paths.mjs）或 ANIMA_DATA（数据根）。
// 都没有就报清楚错，不静默退回某个用户目录里的副本。
const pathsCandidates = [
  process.env.ANIMA_PATHS,
  process.env.ANIMA_DATA ? path.join(process.env.ANIMA_DATA, 'tools', 'paths.mjs') : null,
].filter(Boolean)

const pathsFile = pathsCandidates.find((p) => {
  try { return fs.statSync(p).isFile() } catch { return false }
})
if (!pathsFile) {
  throw new Error(
    '找不到 tools/paths.mjs。请设置 ANIMA_PATHS=/绝对路径/tools/paths.mjs，' +
    '或 ANIMA_DATA=/数据根（其下有 tools/paths.mjs）。试过：' +
    (pathsCandidates.length ? pathsCandidates.join(' | ') : '（两个环境变量都没设）'),
  )
}

const PATHS = await import(pathToFileURL(pathsFile).href)
const P = PATHS.P
const ROOT = PATHS.DATA

const CLI = path.join(ROOT, 'tools', 'pending.mjs')
const MEMCTL = path.join(ROOT, 'memctl.mjs')
const MEMO_CLI = path.join(ROOT, 'tools', 'memo.mjs')
const IMPLOG = P.impLog
const RULES = P.rules
const PERSONA = P.persona
const RULES_SECTION = 'anima-rules'
const PERSONA_SECTION = 'anima-persona'
const RULES_WARN_CHARS = 1200
const PERSONA_ENABLED = process.env.ANIMA_PERSONA_SECTION === '1'

function readPersonaText() {
  try {
    return fs.readFileSync(PERSONA, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()
  } catch {
    return ''
  }
}

// raw 层：只追加，不改写。它保存“发生过什么”，不是“我认为什么重要”。
// 派生层（pending / decay / facts / self / voices）仍然走人审或现有 CLI。
const RAW_DIR = path.join(P.memory, 'raw')
const RAW_ENABLED = process.env.ANIMA_RAW !== '0'
const rawSeen = new Set()
let rawWarned = false

function rawDay(ts) {
  const d = ts ? new Date(ts) : new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function rawFile(ts, name) {
  return path.join(RAW_DIR, name || (rawDay(ts) + '.jsonl'))
}

function rawLoadSeen() {
  if (!RAW_ENABLED) return
  try {
    fs.mkdirSync(RAW_DIR, { recursive: true })
    for (const name of fs.readdirSync(RAW_DIR)) {
      if (!name.endsWith('.jsonl')) continue
      const lines = fs.readFileSync(path.join(RAW_DIR, name), 'utf8').split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line)
          if (r.session && r.seq != null) rawSeen.add(String(r.session) + ':' + String(r.seq))
        } catch {}
      }
    }
  } catch {}
}

function rawAppend(rec, name) {
  if (!RAW_ENABLED) return
  try {
    fs.mkdirSync(RAW_DIR, { recursive: true })
    fs.appendFileSync(rawFile(rec.time, name), JSON.stringify(rec) + '\n', 'utf8')
  } catch (error) {
    if (!rawWarned) {
      rawWarned = true
      console.error('[anima-fovenda] raw write failed: ' + String((error && error.message) || error))
    }
  }
}

function rawText(data) {
  const msg = data && (data.message || data)
  const c = msg && msg.content
  if (!Array.isArray(c)) return typeof c === 'string' ? c : ''
  return c.filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string' })
    .map(function (b) { return b.text }).join('\n')
}

function rawQQ(text) {
  if (!text.startsWith('【QQ 派活 · 外部输入】')) return null
  const m = /内容：([\s\S]*?)(?:\n注意：|$)/.exec(text)
  return {
    source: 'qq-bridge',
    text: m ? m[1].trim() : text,
    rawText: text,
  }
}

function rawHandle(session, event) {
  if (!RAW_ENABLED || !event || !event.type) return
  const data = event.data || {}
  const sid = session && session.id ? String(session.id) : null
  const seq = event.seq == null ? null : String(event.seq)
  if (sid && seq) {
    const key = sid + ':' + seq
    if (rawSeen.has(key)) return
    rawSeen.add(key)
  }
  const base = { v: 1, at: new Date().toISOString(), session: sid, seq: event.seq == null ? null : event.seq, time: event.time == null ? null : event.time, type: event.type }

  if (event.type === 'user/message') {
    const kind = data.source && data.source.kind ? String(data.source.kind) : ''
    if (kind !== 'user') return
    const text = rawText(data)
    if (!text.trim()) return
    const qq = rawQQ(text)
    rawAppend(Object.assign(base, {
      kind: 'user',
      source: qq ? qq.source : 'desktop',
      text: qq ? qq.text : text,
      rawText: qq ? qq.rawText : undefined,
      messageId: data.id == null ? null : data.id,
    }))
    return
  }

  if (event.type === 'assistant/message') {
    const text = rawText(data)
    if (!text.trim()) return
    rawAppend(Object.assign(base, {
      kind: 'assistant',
      role: 'assistant',
      turn: data.turn == null ? null : data.turn,
      step: data.step == null ? null : data.step,
      text,
    }))
    return
  }

  if (event.type === 'tool/call') {
    rawAppend(Object.assign(base, {
      kind: 'tool_call',
      turn: data.turn == null ? null : data.turn,
      step: data.step == null ? null : data.step,
      callId: data.callId == null ? null : data.callId,
      tool: data.name == null ? null : data.name,
    }))
    return
  }

  if (event.type === 'tool/result') {
    rawAppend(Object.assign(base, {
      kind: 'tool_result',
      turn: data.turn == null ? null : data.turn,
      step: data.step == null ? null : data.step,
      error: data.error ? { name: data.error.name || null, code: data.error.code || null } : null,
    }))
    return
  }

  if (event.type === 'compaction/start' || event.type === 'compaction/summary' || event.type === 'compaction/end') {
    const rec = Object.assign(base, {
      kind: event.type.replace('/', '_'),
      compactionId: data.compactionId == null ? null : data.compactionId,
      turn: data.turn == null ? null : data.turn,
    })
    if (event.type === 'compaction/summary') {
      rec.shadowedSeqs = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : null
      rec.shadowedRange = data.shadowedRange || null
      rec.summaryLen = Array.isArray(data.summary)
        ? data.summary.filter(function (b) { return b && b.type === 'text' }).map(function (b) { return b.text }).join('\n').length
        : 0
    }
    if (event.type === 'compaction/end') rec.error = data.error || null
    rawAppend(rec, 'compaction.jsonl')
  }
}


// 最近一次读 rules.md 的结果 —— 页面和 /api 都用它报告「这次到底注入成功没有」
let rulesState = { ok: false, chars: 0, warn: '还没读过', at: null }

function readRulesText() {
  try {
    const raw = fs.readFileSync(RULES, 'utf8')
    // 剥掉 HTML 注释块（文件头那段说明），只留正文
    const text = raw.replace(/<!--[\s\S]*?-->/g, '').trim()
    const warn = text.length > RULES_WARN_CHARS ? '纪律过长（> ' + RULES_WARN_CHARS + ' 字），每轮都在付费' : ''
    rulesState = { ok: true, chars: text.length, warn: warn, at: new Date().toISOString() }
    return text
  } catch (error) {
    rulesState = { ok: false, chars: 0, warn: '读不到 rules.md：' + String((error && error.message) || error), at: new Date().toISOString() }
    return ''
  }
}

function rulesMtime() {
  try { return fs.statSync(RULES).mtimeMs } catch { return null }
}

// 写纪律文件。规则和记忆文件不同：它不是数据（没有状态机、没有第二个写入者），
// 就是一段人写的文本，所以允许从界面直接写 —— 但仍要三步保险：
//   ① 原文没被别人改过（mtime 校验）② 写前留一份 .bak ③ 临时文件 + rename 原子替换
function saveRules(payload) {
  const next = String(payload && payload.text != null ? payload.text : '').replace(/\r\n/g, '\n').trim()
  if (next.length > 4000) return { ok: false, error: '太长（> 4000 字），拒绝写入' }

  const expect = payload && payload.mtime != null ? Number(payload.mtime) : null
  const now = rulesMtime()
  if (expect != null && now != null && Math.abs(now - expect) > 1) {
    return {
      ok: false,
      conflict: true,
      error: '文件在别处被改过了（比如我刚改了一条），先「重新加载」再保存',
      mtime: now,
      text: readRulesText(),
    }
  }

  try {
    const raw = fs.existsSync(RULES) ? fs.readFileSync(RULES, 'utf8') : ''
    const header = (raw.match(/<!--[\s\S]*?-->/) || [''])[0]   // 保留文件头那段说明
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    if (fs.existsSync(RULES)) fs.copyFileSync(RULES, RULES + '.bak-' + stamp)
    const tmp = RULES + '.tmp-' + process.pid
    fs.writeFileSync(tmp, (header ? header + '\n\n' : '') + next + '\n', 'utf8')
    fs.renameSync(tmp, RULES)
    const text = readRulesText()
    return { ok: true, chars: text.length, text: text, mtime: rulesMtime(), backup: RULES + '.bak-' + stamp }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

const FILES = {
  pending: P.pendingFacts,
  memo: P.memo,
  rules: RULES,
  facts: P.facts,
  self: P.selfMd,
  voices: P.voicesMd,
  decay: P.decay,
  snapshots: P.snapshots,
  persona: P.persona,
}

const VIEW_LINES = 200

async function readText(ctx, key) {
  const target = await ctx.fs.resolve(FILES[key])
  return ctx.fs.readText(target)
}

function parsePending(raw) {
  const rows = []
  const lines = String(raw).split('\n')
  let total = 0
  for (const line of lines) {
    if (!line.trim()) continue
    total += 1
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    rows.push(rec)
  }
  return { rows, total }
}

async function buildState(ctx) {
  const paths = []
  for (const key of Object.keys(FILES)) {
    const row = { key, path: FILES[key] }
    try {
      const target = await ctx.fs.resolve(FILES[key])
      const info = await ctx.fs.stat(target)
      row.exists = Boolean(info)
      row.type = info ? info.type : null
      if (info && info.type === 'file') row.size = info.size ?? null
      if (info && info.type === 'directory') {
        try {
          row.children = (await ctx.fs.listDir(target)).length
        } catch {
          row.children = null
        }
      }
    } catch (error) {
      row.exists = false
      row.error = String((error && error.message) || error)
    }
    paths.push(row)
  }

  const missing = paths.filter((p) => !p.exists).map((p) => p.key)

  // 未启用：client 目前自己解析队列文件拿「已处理」列表，见 client.js parseQueueLines。
  const pending = []
  const counts = { pending: 0, accepted: 0, rejected: 0, lines: 0 }
  const decided = []
  let pendingError = null
  try {
    const parsed = parsePending(await readText(ctx, 'pending'))
    counts.lines = parsed.total
    for (const rec of parsed.rows) {
      const status = rec.status || 'pending'
      if (status === 'pending') {
        counts.pending += 1
        pending.push({
          id: rec.id || '',
          text: rec.text || '',
          type: rec.type || '事实',
          src: rec.src || '(无来源)',
          at: rec.at || '',
          imp: rec.imp == null ? 3 : rec.imp,
          suggestedImp: rec.suggestedImp == null ? (rec.imp == null ? 3 : rec.imp) : rec.suggestedImp,
        })
      } else if (status === 'accepted' || status === 'rejected') {
        if (status === 'accepted') counts.accepted += 1
        else counts.rejected += 1
        decided.push({
          id: rec.id || '',
          text: rec.text || '',
          type: rec.type || '事实',
          status,
          decidedAt: rec.decidedAt || '',
          reason: rec.reason || '',
        })
      }
    }
  } catch (error) {
    pendingError = String((error && error.message) || error)
  }

  // 新处理的排前面，「扔过什么、为什么」要一眼能翻到
  decided.sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))

  let persona = null
  try {
    const text = await readText(ctx, 'persona')
    persona = { chars: text.trim().length, path: FILES.persona }
  } catch {
    persona = null
  }

  const snapshots = paths.find((p) => p.key === 'snapshots')

  return {
    ok: missing.length === 0 && !pendingError,
    missing,
    pendingError,
    counts,
    pending,
    decided: decided.slice(0, 40),
    persona,
    snapshotCount: snapshots && typeof snapshots.children === 'number' ? snapshots.children : null,
    paths,
    root: ROOT,
  }
}

async function readFileView(ctx, key, from) {
  if (!Object.hasOwn(FILES, key)) return { ok: false, error: 'unknown file: ' + key }
  try {
    const text = await readText(ctx, key)
    const lines = text.split('\n')
    // 末尾换行会被切成一个空行，别让它算进行数（persona 会显示 27 行其实只有 26 行）
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    const limit = from ? Math.min(lines.length, Math.max(0, from) + 400) : Math.min(VIEW_LINES, lines.length)
    return {
      ok: true,
      key,
      path: FILES[key],
      totalLines: lines.length,
      totalChars: text.length,
      lines: lines.slice(0, limit),
      shown: limit,
    }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

// ── 人格快照：列目录 + 读一份 ──────────────────────────
// 快照文件外面包着一层 markdown 说明，正文在 `## persona.md（源）` 之后到下一个 `## ` 之前。
// 所以 diff 之前必须先切出来，否则比的是一堆元信息。
async function listSnapshots(ctx) {
  try {
    const target = await ctx.fs.resolve(FILES.snapshots)
    const entries = await ctx.fs.listDir(target)
    const files = entries
      .filter((e) => e.type === 'file' && /\.md$/i.test(e.name))
      .map((e) => ({ name: e.name, size: e.size == null ? null : e.size }))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)))
    return { ok: true, files: files.slice(0, 40) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

async function readSnapshot(ctx, name) {
  const safe = String(name || '')
  if (!/^[A-Za-z0-9._-]+\.md$/i.test(safe)) return { ok: false, error: '文件名不合法：' + safe }
  try {
    const target = await ctx.fs.resolve(path.join(FILES.snapshots, safe))
    const text = await ctx.fs.readText(target)
    const lines = text.split('\n')

    let start = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s*persona\.md/.test(lines[i])) { start = i; break }
    }
    let body = lines
    let meta = ''
    if (start >= 0) {
      let end = lines.length
      for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) { end = i; break }
      }
      body = lines.slice(start + 1, end)
      meta = lines.slice(0, start).filter((l) => l.trim().startsWith('>')).map((l) => l.replace(/^>\s?/, '')).join(' · ')
    }
    while (body.length && body[0].trim() === '') body.shift()
    while (body.length && body[body.length - 1].trim() === '') body.pop()
    if (!body.length) return { ok: false, error: '这份快照里没找到 persona 正文' }
    return { ok: true, name: safe, meta: meta, lines: body, totalChars: body.join('\n').trim().length }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

// 跑任意 CLI（pending.mjs / memctl.mjs）。以前这里硬绑 pending.mjs，
// 结果是 imp-set 把参数喂给了 pending 的用法说明 —— 那种错不报错，只会打印一句"用法"。
function runNode(script, args) {
  return runExe(process.execPath, [script, ...args])
}

function runCli(args) {
  return runNode(CLI, args)
}

// 通用执行器：recall 要跑 python，不能只认 node。
function runExe(exe, args, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: extraEnv ? Object.assign({}, process.env, extraEnv) : process.env,
    })
    let out = ''
    // 以前没有超时：子进程一挂（等文件锁、python import 卡住），HTTP 请求就永久悬挂，
    // 只能重启整个 harness 才能恢复。
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      resolve({ ok: false, output: '超时（10s）：' + exe, code: null, timedOut: true })
    }, 10000)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: String((error && error.message) || error), code: null }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: out.trim(), code }) })
  })
}

// python 路径不硬编码：先问 rt.mjs（本机部署里有它，知道这台机器上 python 在哪），
// 问不到就自己探 —— rt.mjs 不进包（它硬编码了本机 ~/.dsh 路径，对别人没用），
// 所以「单点缺失 = 整个检索功能死亡」这件事不能再有。
let pythonPath = null
let pythonProbeNote = null
async function getPython() {
  if (pythonPath) return pythonPath
  try {
    const r = await runNode(path.join(ROOT, 'tools', 'rt.mjs'), [])
    const j = JSON.parse(r.output)
    const candidate = j && j.python ? String(j.python) : ''
    if (candidate && !candidate.startsWith('(') && fs.existsSync(candidate)) pythonPath = candidate
  } catch { /* rt.mjs 不存在或输出不是 JSON：走下面的降级探测 */ }
  if (pythonPath) return pythonPath

  // 降级：直接找解释器，并用 `import jieba` 确认它真能用。
  // 顺序上先试 PATH，再试 DSH 自己的运行时目录 —— DSH 的 python 通常不在 PATH 里，
  // 而 plugin 本身就跑在 DSH 下，所以这条最可能命中（mem-index.py 里也有同样的兜底）。
  const candidates = []
  if (process.platform === 'win32') candidates.push('python', 'py', 'python3')
  else candidates.push('python3', 'python')
  try {
    const home = process.env.USERPROFILE || process.env.HOME || ''
    const rtRoot = path.join(home, '.dsh', 'dsh-runtimes')
    const found = fs.readdirSync(rtRoot)
      .filter((n) => !n.endsWith('.previous'))
      .sort()
      .reverse()
      .map((n) => path.join(rtRoot, n, 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'))
      .filter((p) => fs.existsSync(p))
    candidates.push(...found)
  } catch { /* 没有 dsh-runtimes 就只试 PATH */ }

  const probeEnv = { PYTHONIOENCODING: 'utf-8', PYTHONPATH: path.join(ROOT, 'tools', 'pylibs') }
  for (const exe of candidates) {
    const probe = await runExe(exe, ['-c', 'import jieba'], probeEnv)
    if (probe.ok) {
      pythonPath = exe
      pythonProbeNote = 'rt.mjs 没探到，降级用 ' + exe
      return pythonPath
    }
  }
  pythonProbeNote = '找了一圈没有能 import jieba 的 python（试过：' + candidates.join(' / ') + '）'
  return null
}

async function recallQuery(q, k) {
  const py = await getPython()
  if (!py) return { ok: false, error: '检索需要一个能 import jieba 的 python：' + (pythonProbeNote || '') }
  const r = await runExe(py, [path.join(ROOT, 'tools', 'mem-index.py'), 'recall', q, '--k', String(k)], {
    PYTHONIOENCODING: 'utf-8',
    PYTHONPATH: path.join(ROOT, 'tools', 'pylibs'),
  })
  if (!r.ok && !r.output) return { ok: false, error: '索引查询失败（exit ' + r.code + '）' }
  try {
    const rows = JSON.parse(r.output)
    return { ok: true, q, k, rows }
  } catch (error) {
    // 别再原样回显整段输出：python traceback 里带本机绝对路径。
    // 2026-11-24：索引没建 / 0 块时，python 会打一行可执行的提示，直接原样透出来，
    // 不要裹成「没有返回 JSON」——那句话把人引向错误方向。
    const lines = String(r.output).split('\n').map((s) => s.trim()).filter(Boolean)
    const hint = lines.find((l) => /^索引(还没建|是空的|文件在)/.test(l))
    if (hint) return { ok: false, error: hint.slice(0, 200) }
    const lastLine = lines.length ? lines[lines.length - 1] : ''
    return { ok: false, error: '索引查询没有返回 JSON：' + lastLine.slice(0, 160) }
  }
}

async function handleAction(ctx, payload) {
  const action = payload && payload.action
  if (action === 'state') return { ok: true, state: await buildState(ctx) }
  // 未启用：侧栏角标现在由 client 自己解析队列文件（host 改动要重启才生效）。
  // 下次重启 harness 后想省一次请求，把 client 的 tick() 换成这个就行。
  if (action === 'summary') {
    try {
      const parsed = parsePending(await readText(ctx, 'pending'))
      let n = 0
      for (const rec of parsed.rows) if ((rec.status || 'pending') === 'pending') n += 1
      return { ok: true, pending: n }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  }
  if (action === 'file') return readFileView(ctx, payload.file, Number(payload.from) || 0)
  // 检索：走 mem-index.py recall（BM25 + jieba，带层权重）
  if (action === 'recall') {
    const q = String(payload.q || '').trim()
    if (!q) return { ok: false, error: '缺查询词' }
    const k = Math.min(10, Math.max(1, Number(payload.k) || 5))
    return recallQuery(q, k)
  }
  // 备忘状态：界面只送编号和状态，写法在 tools/memo.mjs（备份 + 原子替换）
  if (action === 'memo-set') {
    const num = Number(payload.num)
    const status = String(payload.status || '✅')
    if (!Number.isInteger(num) || num <= 0) return { ok: false, error: '缺编号' }
    const args = ['set', String(num), '--status', status]
    if (payload.note) args.push('--note', String(payload.note))
    return runNode(MEMO_CLI, args)
  }
  // 手工改 imp 的审计流水（倒序，最新在前）
  if (action === 'imp-log') {
    try {
      if (!fs.existsSync(IMPLOG)) return { ok: true, rows: [] }
      const rows = fs.readFileSync(IMPLOG, 'utf8')
        .split('\n').filter((l) => l.trim())
        .slice(-40)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
        .reverse()
      return { ok: true, rows }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  }
  // 手工改 imp：界面只负责把 id 和值送过来，写入和审计都在 memctl 里做
  if (action === 'imp-set') {
    if (!payload.id) return { ok: false, error: '缺 id' }
    const imp = Number(payload.imp)
    if (!Number.isInteger(imp) || imp < 1 || imp > 5) return { ok: false, error: 'imp 只能是 1-5' }
    const args = ['imp', String(payload.id), '--imp', String(imp)]
    if (payload.why) args.push('--why', String(payload.why))
    const result = await runNode(MEMCTL, args)
    return Object.assign(result, { at: new Date().toISOString() })
  }
  // 纪律页：既回文件正文，也回「系统提示组装时实际拿到的正文」——后者才是真相
  if (action === 'rules') {
    const text = readRulesText()
    let assembled = null
    let assembledError = null
    try {
      const asm = await ctx.systemPrompt.assemble({})
      const hit = (asm.sections || []).filter((s) => s.name === RULES_SECTION)[0]
      assembled = hit ? hit.text : ''
    } catch (error) {
      assembledError = String((error && error.message) || error)
    }
    return {
      ok: true,
      path: RULES,
      chars: text.length,
      text: text,
      state: rulesState,
      mtime: rulesMtime(),
      assembled: assembled,
      assembledChars: assembled == null ? null : assembled.length,
      assembledError: assembledError,
    }
  }
  // 写纪律：这是「配置」不是「数据」—— 只有一个编辑器 + 我，没有别的写入者，
  // 所以允许从界面直接写；但仍要备份 + 原文校验 + 原子替换。
  if (action === 'rules-save') return saveRules(payload)
  if (action === 'snapshots') return listSnapshots(ctx)
  if (action === 'snapshot') return readSnapshot(ctx, payload.name)
  if (action === 'accept') {
    if (!payload.id) return { ok: false, error: '缺 id' }
    // --by owner：CLI 现在要求说明"谁在收"。界面上的点击 = 他本人。
    const args = ['accept', String(payload.id), '--by', 'owner']
    if (payload.imp != null) args.push('--imp', String(payload.imp))
    const result = await runCli(args)
    return Object.assign(result, { at: new Date().toISOString() })
  }
  if (action === 'reject') {
    if (!payload.id) return { ok: false, error: '缺 id' }
    const reason = String(payload.reason || '界面里扔掉').slice(0, 200)
    const result = await runCli(['reject', String(payload.id), '--reason', reason, '--by', 'owner'])
    return Object.assign(result, { at: new Date().toISOString() })
  }
  // 收进长期：插小节 + memctl 留档 + 标 accepted 全在 CLI 里做，失败会回滚文件
  if (action === 'route') {
    if (!payload.id) return { ok: false, error: '缺 id' }
    if (!payload.to) return { ok: false, error: '缺去处（facts / self / voices）' }
    const args = ['accept', String(payload.id), '--to', String(payload.to), '--by', 'owner']
    if (payload.imp != null) args.push('--imp', String(payload.imp))
    if (payload.section) args.push('--section', String(payload.section))
    if (payload.wording) args.push('--wording', String(payload.wording))
    const result = await runCli(args)
    return Object.assign(result, { at: new Date().toISOString() })
  }
  return { ok: false, error: 'unknown action: ' + String(action) }
}

// 请求体上限 1 MB。以前是无限累积字符串，同机任意进程发 20 MB 就能把宿主进程内存顶高。
const MAX_BODY = 1024 * 1024
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    let aborted = false
    req.on('data', (chunk) => {
      if (aborted) return
      data += chunk
      if (data.length > MAX_BODY) {
        aborted = true
        try { req.destroy() } catch {}
        resolve({ __tooLarge: true })
      }
    })
    req.on('end', () => {
      if (aborted) return
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

// ── 本地 API 的边界 ───────────────────────────────────────
// 2026-11-14：以前任何方法都能调任意 action，且不校验 Origin/Host。
// CORS 只挡「读响应」，不挡「请求发出」——一个 <img src="http://127.0.0.1:PORT/...?action=rules-save">
// 就能改写 rules.md，而 rules 每轮注入系统提示，等于持久化提示注入。
// 现在三道闸：Host 必须是回环（防 DNS rebinding）、Origin 必须是回环、写操作只收 POST+JSON。
const READ_ACTIONS = new Set(['state', 'summary', 'file', 'recall', 'rules', 'snapshots', 'snapshot', 'imp-log'])
const EXTRA_ORIGINS = String(process.env.ANIMA_TRUSTED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function hostIsLoopback(value) {
  if (!value) return null
  try {
    const h = new URL('http://' + value).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return h === '127.0.0.1' || h === 'localhost' || h === '::1'
  } catch {
    return false
  }
}

function originAllowed(origin) {
  if (!origin) return true            // 同源 GET 不带 Origin；浏览器跨源请求一定带
  if (EXTRA_ORIGINS.includes(origin)) return true
  try {
    const u = new URL(origin)
    const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return h === '127.0.0.1' || h === 'localhost' || h === '::1'
  } catch {
    return false
  }
}

export function apply(ctx) {
  // raw 捕获：session 事件提交后立即追加；不依赖上下文压缩。
  if (RAW_ENABLED) {
    rawLoadSeen()
    ctx.on('session/event', rawHandle)
  }

  // 人格 section 是 opt-in：默认关，避免和本机已有 personaPrefix 重复。
  // 关掉时 persona.md 只用于「人格」页展示；打开后文件驱动，不改系统提示配置。
  if (PERSONA_ENABLED) {
    ctx.effect(
      () => ctx.systemPrompt.section({
        name: PERSONA_SECTION,
        order: 100,
        text: () => readPersonaText(),
      }),
      'anima-fovenda: persona section',
    )
  }

  // 纪律块：注册成系统提示里的一段，正文是函数 → 每次组装都重新读盘。
  // 这就是「改 rules.md 下一条消息就生效」的实现方式；空文件时返回空字符串（不占位）。
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: RULES_SECTION,
      order: 900,
      text: () => readRulesText(),
    }),
    'anima-fovenda: rules section',
  )

  ctx.inject(['webServer'], (child) => {
    child.effect(
      () => child.webServer.register({
        kind: 'exact',
        path: '/anima-fovenda/api',
        handler: async (req, res) => {
          const sendJson = (obj, status) => {
            res.writeHead(status || 200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            res.end(JSON.stringify(obj))
          }
          try {
            const headers = req.headers || {}
            if (headers.host && hostIsLoopback(headers.host) === false) {
              sendJson({ ok: false, error: '拒绝：Host 不是本机回环（防 DNS rebinding）' }, 403)
              return
            }
            if (!originAllowed(headers.origin)) {
              sendJson({ ok: false, error: '拒绝：Origin 不是本机回环' }, 403)
              return
            }

            const isPost = req.method === 'POST'
            let payload
            if (isPost) {
              // 跨源 <form> 发不出 application/json（会先触发预检，而这里不给 CORS 头）。
              // 所以「必须是 JSON」这一条本身就挡住了一整类 CSRF，不只是格式校验。
              const ct = String(headers['content-type'] || '').toLowerCase()
              if (!ct.includes('application/json')) {
                sendJson({ ok: false, error: '写接口只接受 application/json' }, 415)
                return
              }
              payload = await readBody(req)
              if (payload && payload.__tooLarge) {
                sendJson({ ok: false, error: '请求体超过 1 MB' }, 413)
                return
              }
            } else {
              const url = new URL(req.url || '/api', 'http://localhost')
              payload = Object.fromEntries(url.searchParams.entries())
            }

            const action = String((payload && payload.action) || '')
            // 写操作一律要求 POST：GET 带副作用意味着 <img>/<link> 就能触发
            if (!isPost && !READ_ACTIONS.has(action)) {
              sendJson({
                ok: false,
                error: '写操作只接受 POST；GET 仅限 ' + [...READ_ACTIONS].join(' / '),
              }, 405)
              return
            }

            sendJson(await handleAction(ctx, payload))
          } catch (error) {
            sendJson({ ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
      'anima-fovenda: http api',
    )
  })
}
