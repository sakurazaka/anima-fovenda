// session-digest.mjs —— 把 raw 里最近 N 天的会话压成「谁在干什么」
//
// 为什么要有它：raw 是全量主文件（host 每条会话事件都写），但那是给「事后取证」用的。
// 新会话想知道「昨天别处发生了什么」时，去 raw 里翻几 MB 不经济；handoff.md 又太重且只能手改。
// 所以这里只做一个**视图**：不改 raw、不新建记忆文件、不调模型。
//
// 用法：
//   node session-digest.mjs                 # 最近 1 天，每会话 3 行
//   node session-digest.mjs --days 2 --max 12
//   node session-digest.mjs --json          # 给别的脚本用
//
// 只读：不写任何文件。要落盘由人决定。

import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.mjs'

const AV = process.argv.slice(2)
const arg = (name, def) => {
  const i = AV.indexOf('--' + name)
  return i >= 0 && AV[i + 1] ? AV[i + 1] : def
}
const DAYS = Number(arg('days', '1')) || 1
const MAX = Number(arg('max', '12')) || 12
const AS_JSON = AV.includes('--json')
// --write：把每天压成 memory/timeline/<日期>.md（幂等，重跑覆盖）
const WRITE = AV.includes('--write')
// --session <id 前缀> --tail N：只看一个会话，输出最近 N 轮「你说了什么 / 我回了什么」
// 用来接话，不是用来看台账；截断比台账宽，因为要看语气。
const WANT = arg('session', '')
const TAIL = Number(arg('tail', '6')) || 6
const WIDE = AV.includes('--wide') ? 400 : 160

const RAW = path.join(P.memory, 'raw')
const CUT = 60

const dayKey = (d) => {
  const x = d instanceof Date ? d : new Date(d)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
const hm = (ts) => {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const cut = (s, n = CUT) => {
  const t = flat(s)
  return t.length > n ? t.slice(0, n) + '…' : t
}

// 最近 N 天：文件名就是 YYYY-MM-DD.jsonl
const files = []
const today = new Date()
for (let i = 0; i < DAYS; i++) {
  const d = new Date(today.getTime() - i * 86400000)
  const f = path.join(RAW, dayKey(d) + '.jsonl')
  if (fs.existsSync(f)) files.push(f)
}
if (!files.length) {
  console.log('最近 ' + DAYS + ' 天没有 raw 文件（' + RAW + '）')
  process.exit(0)
}

// 单会话模式：接话用。按时间正序读，只留最近的对话行。
if (WANT) {
  const entries = []
  for (const f of [...files].reverse()) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      const sid = String(rec.session || '')
      if (!sid.startsWith(WANT)) continue
      if (rec.kind !== 'user' && rec.kind !== 'assistant') continue
      const t = flat(rec.text)
      if (!t) continue
      entries.push({ ts: rec.time || rec.at, who: rec.kind === 'user' ? '他' : '我', t })
    }
  }
  if (!entries.length) {
    console.log('最近 ' + DAYS + ' 天里没有匹配 "' + WANT + '" 的对话。')
    process.exit(0)
  }
  const tail = entries.slice(-TAIL * 2)
  console.log('最近 ' + TAIL + ' 轮（' + dayKey(tail[0].ts) + ' ' + hm(tail[0].ts) + ' 起，共 ' + entries.length + ' 条对话）：')
  for (const e of tail) {
    const t = e.t.length > WIDE ? e.t.slice(0, WIDE) + '…' : e.t
    console.log('')
    console.log('[' + hm(e.ts) + '] ' + e.who + '：' + t)
  }
  process.exit(0)
}

function aggregate(fileList) {
  const sessions = new Map()
  let bad = 0
  for (const f of fileList) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      let rec
      try { rec = JSON.parse(line) } catch { bad += 1; continue }   // 坏行跳过，不带崩整本
      const sid = String(rec.session || '')
      if (!sid) continue
      let s = sessions.get(sid)
      if (!s) {
        s = { id: sid, from: null, to: null, n: 0, tools: new Set(), firstUser: '', lastAny: '', channels: new Set() }
        sessions.set(sid, s)
      }
      const t = rec.time || rec.at
      if (t) {
        if (s.from == null) s.from = t
        s.to = t
      }
      s.n += 1
      if (rec.kind === 'tool_call' && rec.tool) s.tools.add(String(rec.tool))
      if (rec.kind === 'user') {
        if (rec.source) s.channels.add(String(rec.source))
        if (!s.firstUser && flat(rec.text)) s.firstUser = flat(rec.text)
      }
      if (rec.kind === 'assistant' && flat(rec.text)) s.lastAny = flat(rec.text)
    }
  }
  return { sessions, bad }
}

// --write：每天落一份 memory/timeline/<日期>.md。
// 只记「哪个窗、什么时候、起首那句」，不写判断不写感想——判断是人的事。
// 重跑覆盖同一天的文件，所以它是幂等的：晚上跑了，白天补跑还是同一份，只是更长。
if (WRITE) {
  const dir = path.join(P.memory, 'timeline')
  fs.mkdirSync(dir, { recursive: true })
  let wrote = 0
  for (const f of files) {
    const day = path.basename(f, '.jsonl')
    const { sessions: ss } = aggregate([f])
    const lines = [...ss.values()]
      .sort((a, b) => (a.from || 0) - (b.from || 0))
      .map((s) => {
        const t = s.from && s.to ? hm(s.from) + '–' + hm(s.to) : (s.to ? hm(s.to) : '')
        const ch = [...s.channels].join('+') || '—'
        return '- **' + t + '** `' + s.id.slice(0, 12) + '`（' + ch + '，' + s.n + ' 条）' + (s.firstUser ? ' 起：' + cut(s.firstUser, 80) : '')
      })
    const md = [
      '# ' + day,
      '',
      '> 自动生成，可重跑覆盖。只记「哪个窗、什么时候、起首那句」；判断和感想不在这里。',
      '',
      ...(lines.length ? lines : ['- （这天没有 raw 记录）']),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(dir, day + '.md'), md, 'utf8')
    wrote += 1
  }
  console.log('已写 ' + wrote + ' 份 → ' + dir)
  process.exit(0)
}

const { sessions, bad } = aggregate(files)

const rows = [...sessions.values()]
  .sort((a, b) => (b.to || 0) - (a.to || 0))
  .slice(0, MAX)
  .map((s) => ({
    session: s.id.slice(0, 12),
    channel: [...s.channels].join('+') || '—',
    from: s.from ? hm(s.from) : '',
    to: s.to ? hm(s.to) : '',
    msgs: s.n,
    tools: [...s.tools].slice(0, 6).join(','),
    first: cut(s.firstUser),
    last: cut(s.lastAny),
  }))

if (AS_JSON) {
  console.log(JSON.stringify({ days: DAYS, sessions: rows, badLines: bad }, null, 2))
} else {
  console.log('最近 ' + DAYS + ' 天 · ' + rows.length + ' 个会话' + (bad ? '（跳过 ' + bad + ' 坏行）' : ''))
  for (const r of rows) {
    const t = r.from && r.to ? r.from + '–' + r.to : (r.to || r.from)
    console.log('')
    console.log(r.session + '  ' + t + '  ' + r.channel + '  ' + r.msgs + ' 条' + (r.tools ? '  [' + r.tools + ']' : ''))
    if (r.first) console.log('  起：' + r.first)
    if (r.last) console.log('  末：' + r.last)
  }
}
