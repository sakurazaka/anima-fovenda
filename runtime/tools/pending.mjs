// 待审队列：新记忆先进这里，过审才进 decay
//
// 为什么：2026-11-03 复盘发现，`memctl add` 是「直接入账」——没人审就都算数。
// 于是「越界改自己」「把写进文件当已送达」这类账，事后只能靠人发现。
// 这里加一层闸：候选 → 收 / 降级 / 扔，**每条带来源，没来源不许自动过**。
//
// 用法：
//   node pending.mjs add "内容" --type 事实|偏好|承诺|推断 --src "来源" [--imp 4]
//   node pending.mjs list [--all]
//   node pending.mjs accept <id> [--imp 5]                    → 进 decay
//   node pending.mjs accept <id> --to facts|self|voices [--section "关于他"]
//                                                             → 插进长期文件的指定小节 + 留档 + 标 accepted
//   node pending.mjs sections [--to facts|self|voices]        → 列出可选小节
//   node pending.mjs reject <id> --reason "为什么扔"
//   node pending.mjs stats
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { P, DATA } from './paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const W = DATA
const FILE = P.pendingFacts
const MEMCTL = path.join(DATA, 'memctl.mjs')
const BACKUP_DIR = path.join(P.memory, '.pre-route')
const TYPES = new Set(['事实', '偏好', '承诺', '推断'])

// 长期层的三个去处。fact 是有小节的结构化 bullets —— 所以「收进 facts」不是 append，
// 是插到正确小节里；voices 是表格；self 是有日期的 bullets。
const SECTIONS = {
  facts: { file: () => path.join(W, 'memory', 'facts.md'), def: '关于他', kind: 'bullets' },
  self: { file: () => path.join(W, 'memory', 'self', 'self.md'), def: '我学到的', kind: 'bullets-dated' },
  voices: { file: () => path.join(W, 'memory', 'self', 'voices.md'), def: '对我的要求', kind: 'table' },
}

const read = () => {
  try {
    return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
const now = () => new Date().toISOString()
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

// 2026-11-14：队列以前是整文件 writeFileSync —— 两个写入者（外部 agent 调 add，
// 人在界面点收/扔）同时发生会丢一条且不报错；写一半被杀会留半行 JSON，
// read() 又会静默跳过坏行，等于「已做出的决定集体消失」。
// 现在：进程锁 + tmp/rename 原子替换 + 写前备份。保留最近 20 份。
const KEEP_BAKS = 20
const QUEUE_BAK_DIR = path.join(path.dirname(FILE), '.queue-baks')

function pruneBaks() {
  try {
    const files = fs.readdirSync(QUEUE_BAK_DIR)
      .filter((n) => n.startsWith('pending-facts.jsonl.'))
      .sort()
    for (const name of files.slice(0, Math.max(0, files.length - KEEP_BAKS))) {
      try { fs.unlinkSync(path.join(QUEUE_BAK_DIR, name)) } catch {}
    }
  } catch {}
}

function backupQueue() {
  try {
    fs.mkdirSync(QUEUE_BAK_DIR, { recursive: true })
    if (!fs.existsSync(FILE)) return
    const dest = path.join(QUEUE_BAK_DIR, 'pending-facts.jsonl.' + now().replace(/[:.]/g, '-') + '.bak')
    fs.copyFileSync(FILE, dest)
    pruneBaks()
  } catch {}
}

function writeAtomic(file, content) {
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

function write(rows) {
  backupQueue()
  writeAtomic(FILE, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
}

// 进程间互斥：wx 抢锁，超过 30s 视为残留锁并接管，等不到就报错而不是静默覆盖。
const LOCK = FILE + '.lock'
const sleepSync = (ms) => { const until = Date.now() + ms; while (Date.now() < until) {} }
function withLock(fn) {
  const started = Date.now()
  // 锁文件要落在队列同目录，首次运行（init 之前）目录可能还不存在
  try { fs.mkdirSync(path.dirname(LOCK), { recursive: true }) } catch {}
  for (;;) {
    try {
      const fd = fs.openSync(LOCK, 'wx')
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const st = fs.statSync(LOCK)
        if (Date.now() - st.mtimeMs > 30000) { try { fs.unlinkSync(LOCK) } catch {} ; continue }
      } catch {}
      if (Date.now() - started > 10000) throw new Error('队列被占用（锁超时）：' + LOCK)
      sleepSync(50)
    }
  }
  const release = () => { try { fs.unlinkSync(LOCK) } catch {} }
  // 错误路径里大量 process.exit()，不会走 finally —— 用 exit 钩子兜住，别留残留锁。
  process.on('exit', release)
  try {
    return fn()
  } finally {
    process.removeListener('exit', release)
    release()
  }
}

// 只审计，不改变记忆字段：建议值和最终值都留在 imp-log，decay 里只有最终 imp。
function logImp(r, suggested, decided, by, why) {
  try {
    fs.appendFileSync(P.impLog, JSON.stringify({
      at: now(), id: r.id, from: suggested, to: decided,
      suggested, decided, by: by || null, why: why || null,
      text: String(r.text || '').slice(0, 120),
    }) + '\n', 'utf8')
  } catch {}
}

function add(text, opt) {
  if (!text) { console.error('要写什么？'); process.exit(1) }
  const type = opt.type || '事实'
  if (!TYPES.has(type)) { console.error('--type 只能是：' + [...TYPES].join(' / ')); process.exit(1) }
  if (!opt.src) { console.error('必须给 --src（来源）。没来源的条目不许进队列。'); process.exit(1) }
  withLock(() => {
    const rows = read()
    // 去重：同文同来源
    if (rows.some((r) => r.text === text && r.src === opt.src)) { console.log('· 已存在，跳过'); return }
    const rec = {
      id: newId(), at: now(), text, type, src: opt.src,
      imp: Number(opt.imp) || 3, suggestedImp: Number(opt.imp) || 3,
      status: 'pending', decidedAt: null, reason: null,
    }
    rows.push(rec); write(rows)
    console.log('已入待审：' + rec.id + '（' + type + '，等待收/扔）')
    // 判据放在执行点：写的时候一定看得到，不进每轮注入。
    console.log('  · 只记「关于他 / 关系 / 会改变判断的结论」；运维知识写 ops，过程写 CHANGELOG')
  })
}

function list(all) {
  const rows = read().filter((r) => all || r.status === 'pending')
  if (!rows.length) { console.log('待审队列空着'); return }
  for (const r of rows) {
    const mark = r.status === 'pending' ? '○' : r.status === 'accepted' ? '✓' : '✗'
    console.log(`${mark} ${r.id}  [${r.type}]  ${r.text.slice(0, 80)}`)
    console.log(`    来源：${r.src} · 建议 imp ${r.suggestedImp == null ? r.imp : r.suggestedImp}${r.to ? ' · 去处：' + r.to + (r.section ? ' / ' + r.section : '') : ''}${r.reason ? ' · 理由：' + r.reason : ''}`)
  }
}

// 2026-11-08：收/扔必须说明「谁」在操作。
// 背景：当天的看片唤醒流程自己把两条候选收了，而 rules 里写着「该不该记，判断权在他不在我」。
//   —— 光靠文档约束不住，所以在入口加一道闸：不带 --by 直接拒。
//   人能过（--by owner），自动流程要过就得留下自己的名字，事后可查。
function whoami(opt) {
  const by = String(opt.by ?? '').trim()
  if (!by) {
    console.error('收/扔必须带 --by（谁在操作）。例：--by owner；自动流程不该调用这个命令。')
    process.exit(1)
  }
  return by
}

function decide(id, status, reason, imp, by) {
  withLock(() => {
    const rows = read()
    const r = rows.find((x) => x.id === id)
    if (!r) { console.error('没有这条：' + id); process.exit(1) }
    if (r.status !== 'pending') { console.error('已经处理过：' + r.status); process.exit(1) }

    if (status === 'accepted') {
      // 收 → 真进 decay（走 memctl，保持单一写入口）
      const suggested = Number(r.imp) || 3
      const finalImp = Number(imp) || suggested
      if (!Number.isInteger(finalImp) || finalImp < 1 || finalImp > 5) { console.error('--imp 只能是 1-5 的整数'); process.exit(1) }
      const args = [MEMCTL, 'add', r.text, '--imp', String(finalImp), '--src', 'pending', '--kind', r.type === '承诺' ? 'promise' : 'event', '--from-pending']
      execFileSync(process.execPath, args, { stdio: 'inherit' })
      r.decidedImp = finalImp
      logImp(r, suggested, finalImp, by, 'pending accept')
    }
    r.status = status
    r.decidedAt = now()
    r.reason = reason || null
    r.by = by || null
    write(rows)
    console.log((status === 'accepted' ? '✓ 收下：' : '✗ 扔掉：') + id + (by ? '（by ' + by + '）' : ''))
  })
}

// ── 收进长期 ────────────────────────────────────────────
// 三件事一次做完：插到正确小节 → memctl 留档 → 队列标 accepted。
// 任何一步失败都回滚文件，不留半截。

function headingsOf(lines) {
  const out = []
  for (const line of lines) {
    const m = /^##\s+(.*?)\s*$/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

function findSection(lines, name) {
  // 同名小节可能有好几个（比如「关于他」和「关于他（补 · 2026-11-01）」）——取最后一个，也就是最新的
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.*?)\s*$/.exec(lines[i])
    if (m && m[1].includes(name)) start = i
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break }
  }
  return { start, end }
}

function insertAt(lines, range, kind) {
  let last = -1
  for (let i = range.start + 1; i < range.end; i++) {
    const t = lines[i]
    if (!t.trim()) continue
    // `---` 是段落分隔线，不属于任何小节的正文；插到它后面就跑到节外去了
    if (/^\s*-{3,}\s*$/.test(t)) continue
    if (kind === 'table') {
      if (t.trim().startsWith('|')) last = i
    } else if (!t.trim().startsWith('>')) {
      last = i
    }
  }
  return last < 0 ? -1 : last + 1
}

function backupOf(file) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = now().replace(/[:.]/g, '-')
  const dest = path.join(BACKUP_DIR, path.basename(file) + '.' + stamp + '.bak')
  fs.copyFileSync(file, dest)
  return dest
}

function sections(target) {
  const keys = target ? [target] : Object.keys(SECTIONS)
  for (const key of keys) {
    const cfg = SECTIONS[key]
    if (!cfg) { console.error('--to 只能是：' + Object.keys(SECTIONS).join(' / ')); process.exit(1) }
    if (!fs.existsSync(cfg.file())) { console.log(key + '：文件不存在（' + cfg.file() + '）'); continue }
    const heads = headingsOf(fs.readFileSync(cfg.file(), 'utf8').split('\n'))
    console.log(key + '（' + cfg.file() + '）')
    for (const h of heads) console.log('  · ' + h)
  }
}

function routeTo(id, target, section, imp, wording, by) {
  const cfg = SECTIONS[target]
  if (!cfg) { console.error('--to 只能是：' + Object.keys(SECTIONS).join(' / ')); process.exit(1) }
  withLock(() => {
  const rows = read()
  const r = rows.find((x) => x.id === id)
  if (!r) { console.error('没有这条：' + id); process.exit(1) }
  if (r.status !== 'pending') { console.error('已经处理过：' + r.status); process.exit(1) }

  const file = cfg.file()
  if (!fs.existsSync(file)) { console.error('目标文件不存在：' + file); process.exit(1) }
  const suggested = Number(r.imp) || 3
  const finalImp = Number(imp) || suggested
  if (!Number.isInteger(finalImp) || finalImp < 1 || finalImp > 5) { console.error('--imp 只能是 1-5 的整数'); process.exit(1) }
  const raw = fs.readFileSync(file, 'utf8')
  const lines = raw.split('\n')
  let name = section || cfg.def
  let range = findSection(lines, name)
  // 新数据树的 facts 模板可能用「关于用户 / 背景与约定」——没有旧默认节时，落到第一个二级标题
  if (!range && !section) {
    const first = headingsOf(lines)[0]
    if (first) { name = first; range = findSection(lines, first) }
  }
  if (!range) {
    console.error('找不到小节「' + name + '」，什么都没写。可选：\n  ' + headingsOf(lines).join('\n  '))
    process.exit(1)
  }

  const date = String(r.at || now()).slice(0, 10)
  // 队列里的正文是转述，长期层要的是结论。--wording 就是先嚼一遍的机会：
  // 不给就原样写（默认不改写）；给了就写改过的，留档和队列记录也一起换，免得两边说法不一致。
  const text = String(wording || r.text || '').replace(/\r?\n/g, ' ')
  let line
  if (cfg.kind === 'table') line = '| ' + date + ' | 「' + text + '」 | ' + (r.src || '待审队列') + ' |'
  else if (cfg.kind === 'bullets-dated') {
    // 正文自己已经带了日期就别再加一个（2026-11-04：… → 只留 CLI 加的那个）
    const bare = text.replace(/^\d{4}-\d{2}-\d{2}\s*[：:]\s*/, '')
    line = '- **' + date + '**：' + bare
  } else line = '- ' + text

  const at = insertAt(lines, range, cfg.kind === 'table' ? 'table' : 'bullets')
  if (at < 0) { console.error('小节「' + name + '」里没有可插入的位置，什么都没写。'); process.exit(1) }
  lines.splice(at, 0, line)

  const bak = backupOf(file)
  try {
    writeAtomic(file, lines.join('\n'))
    // 2026-11-11：进 decay 的副本带上回指（源文件 + 行号），派生层不再像第二个主文件
    const ref = path.basename(file) + ':' + (at + 1)
    execFileSync(process.execPath,
      [MEMCTL, 'add', text, '--imp', String(finalImp), '--src', 'pending', '--kind', r.type === '承诺' ? 'promise' : 'event', '--ref', ref, '--from-pending'],
      { stdio: 'inherit' })
  } catch (error) {
    fs.copyFileSync(bak, file)
    console.error('写入失败，已回滚到：' + bak)
    console.error(String(error && error.message || error))
    process.exit(1)
  }

  r.status = 'accepted'
  r.decidedAt = now()
  r.to = target
  r.section = name
  r.decidedImp = finalImp
  r.reason = null
  r.by = by || null
  r.text = text   // 队列里也换成最终措辞，「已处理」才不会和长期文件对不上
  logImp(r, suggested, finalImp, by, 'pending route ' + target)
  write(rows)
  console.log('✓ 收进 ' + target + ' · ' + name + '：' + id + '（备份 ' + path.basename(bak) + (by ? '，by ' + by : '') + '）')
  })
}

function stats() {
  const rows = read()
  const p = rows.filter((r) => r.status === 'pending').length
  const a = rows.filter((r) => r.status === 'accepted').length
  const j = rows.filter((r) => r.status === 'rejected').length
  console.log(`待审队列：待审 ${p} · 已收 ${a} · 已扔 ${j}（扔的不删档，留理由）`)
}

const [cmd, ...rest] = process.argv.slice(2)
const opt = {}
for (let i = 1; i < rest.length; i += 2) {
  const k = String(rest[i]).replace(/^--/, '')
  if (k) opt[k] = rest[i + 1]
}
if (cmd === 'add') add(rest[0], opt)
else if (cmd === 'list') list(rest.includes('--all'))
else if (cmd === 'sections') sections(opt.to)
else if (cmd === 'accept' && opt.to) routeTo(opt.id || rest[0], opt.to, opt.section, Number(opt.imp), opt.wording, whoami(opt))
else if (cmd === 'accept') decide(opt.id || rest[0], 'accepted', null, Number(opt.imp), whoami(opt))
else if (cmd === 'reject') decide(rest[0], 'rejected', opt.reason, 0, whoami(opt))
else if (cmd === 'stats') stats()
else console.log('用法: add / list [--all] / sections [--to facts|self|voices] / accept <id> --by owner [--to X --section Y] / reject <id> --reason "…" --by owner / stats')
