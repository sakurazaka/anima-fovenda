#!/usr/bin/env node
// check-open.mjs —— 未结问题台账：跑一遍内置检查，自动登记 / 自动收口
//
// 为什么要有它：22:00 的报告只报「今天怎么样」，人没看就过去了；
// 而「等人删 / 等人记得」和「等人看报告」是同一个依赖。
// 这里把「报错」变成有状态的东西：检查不通过就登记，之后每次跑都重提；
// **收口由机器判定**——对应检查通过就自动结案，不靠谁动手删。
//
// 用法：
//   node tools/check-open.mjs              # 复跑全部检查，打印仍开着的（未修天数）
//   node tools/check-open.mjs --json       # 同上，输出 JSON（给定时任务用）
//   node tools/check-open.mjs list         # 只看台账
//   node tools/check-open.mjs add --key <k> --what "现象" [--expect 期望] [--how 复现]
//   node tools/check-open.mjs close <key> [--why "理由"]   # 人判定的项才需要手动关
//
// 台账：<数据根>/memory/open-issues.jsonl
// 已结案：<数据根>/memory/open-issues-closed.jsonl（留档，不再提）
import fs from 'node:fs'
import path from 'node:path'
import { P } from './paths.mjs'

const LEDGER = path.join(P.memory, 'open-issues.jsonl')
const CLOSED = path.join(P.memory, 'open-issues-closed.jsonl')
const today = () => new Date().toISOString().slice(0, 10)
const daysSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000)

const readJsonl = (p) => (fs.existsSync(p)
  ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  : [])
const writeJsonl = (p, rows) => fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))

// ── 内置检查：全部是机械判定，返回值 {pass, detail} ─────────────
const CHECKS = {
  // 归档层里不许出现重要条目：规则是 imp>=4 永不自动归档
  imp_ge4_archived: () => {
    const rows = readJsonl(P.decay)
    const bad = rows.filter((r) => r.state === 'archived' && Number(r.imp) >= 4)
    return {
      pass: bad.length === 0,
      detail: bad.length ? `${bad.length} 条 imp>=4 被归档：` + bad.slice(0, 3).map((r) => r.id).join(', ') : 'ok',
      how: 'node memctl.mjs stats 看归档分布；用备份把条目放回活跃，见 tools/restore-archived.mjs',
    }
  },

  // decay 里的每条都应该能在 full 里找到（full 是只增的全量档）
  decay_subset_full: () => {
    const decay = readJsonl(P.decay)
    const fullIds = new Set(readJsonl(P.full).map((r) => r.id))
    const missing = decay.filter((r) => !fullIds.has(r.id))
    return {
      pass: missing.length === 0,
      detail: missing.length ? `${missing.length} 条在 full 里找不到：` + missing.slice(0, 3).map((r) => r.id).join(', ') : 'ok',
      how: 'node tools/audit.mjs 的 B 段会逐条列出来',
    }
  },

  // 索引文件必须在（空索引会让检索永远「没命中」，最难自查的一类故障）
  index_present: () => {
    const p = path.join(P.memory, 'index', 'mem.db')
    if (!fs.existsSync(p)) return { pass: false, detail: '索引文件不存在', how: 'python tools/mem-index.py build --docs' }
    const size = fs.statSync(p).size
    return { pass: size > 8192, detail: size > 8192 ? `ok (${size} 字节)` : `索引只有 ${size} 字节，几乎肯定是空的`, how: 'python tools/mem-index.py stats' }
  },

  // 待审队列里同一段文本不该重复堆积
  pending_dup: () => {
    const rows = readJsonl(P.pendingFacts)
    const seen = new Map()
    for (const r of rows) {
      const t = String(r.text || '').trim()
      if (!t) continue
      seen.set(t, (seen.get(t) || 0) + 1)
    }
    const dup = [...seen.entries()].filter(([, n]) => n > 1)
    return {
      pass: dup.length === 0,
      detail: dup.length ? `${dup.length} 段文本重复入队（共 ${rows.length} 条）` : `ok (${rows.length} 条)`,
      how: 'node tools/pending.mjs list；重复的扔一条，理由写「重复」',
    }
  },
}

// ── 子命令 ──────────────────────────────────────────────
const argv = process.argv.slice(2)
const cmd = argv[0] || 'run'
const flag = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : null
}

if (cmd === 'add') {
  const key = flag('key')
  const what = flag('what')
  if (!key || !what) { console.error('用法: add --key <k> --what "现象" [--expect …] [--how …]'); process.exit(1) }
  const rows = readJsonl(LEDGER)
  if (rows.some((r) => r.key === key)) { console.log('已存在同名条目，未重复登记：' + key); process.exit(0) }
  rows.push({ key, since: today(), what, expect: flag('expect') || null, how: flag('how') || null, fails: 1, lastFail: today(), source: 'manual' })
  writeJsonl(LEDGER, rows)
  console.log('已登记：' + key)
  process.exit(0)
}

if (cmd === 'close') {
  const key = argv[1]
  const rows = readJsonl(LEDGER)
  const hit = rows.filter((r) => r.key === key)
  if (!hit.length) { console.log('没有这条：' + key); process.exit(0) }
  const rest = rows.filter((r) => r.key !== key)
  const closed = readJsonl(CLOSED)
  for (const r of hit) closed.push({ ...r, closedAt: new Date().toISOString(), why: flag('why') || 'manual' })
  writeJsonl(LEDGER, rest)
  writeJsonl(CLOSED, closed)
  console.log('已结案：' + key)
  process.exit(0)
}

if (cmd === 'list') {
  const rows = readJsonl(LEDGER)
  if (!rows.length) { console.log('台账是空的'); process.exit(0) }
  for (const r of rows) console.log(`${String(daysSince(r.since)).padStart(3)} 天  ${r.key}  ${r.what}`)
  process.exit(0)
}

// ── run：复跑全部检查，自动登记 / 自动收口 ─────────────────
const rows = readJsonl(LEDGER)
const byKey = new Map(rows.map((r) => [r.key, r]))
const results = []
const closedNow = []

for (const [key, fn] of Object.entries(CHECKS)) {
  let res
  try { res = fn() } catch (e) { res = { pass: false, detail: '检查本身报错：' + String(e.message).slice(0, 120), how: null } }
  const existing = byKey.get(key)

  if (res.pass) {
    if (existing) { closedNow.push(existing); byKey.delete(key) }
    results.push({ key, status: 'ok', detail: res.detail })
  } else {
    if (existing) {
      existing.fails = (existing.fails || 0) + 1
      existing.lastFail = today()
      existing.detail = res.detail
    } else {
      byKey.set(key, { key, since: today(), what: res.detail, expect: '检查通过', how: res.how, fails: 1, lastFail: today(), source: 'auto' })
    }
    results.push({ key, status: 'fail', detail: res.detail, how: res.how })
  }
}

// 台账里没有对应自动检查的（人情判断类），原样保留
const stillOpen = [...byKey.values()].sort((a, b) => daysSince(b.since) - daysSince(a.since))

writeJsonl(LEDGER, stillOpen)
if (closedNow.length) {
  const closed = readJsonl(CLOSED)
  for (const r of closedNow) closed.push({ ...r, closedAt: new Date().toISOString(), why: 'auto: 检查通过' })
  writeJsonl(CLOSED, closed)
}

if (argv.includes('--json')) {
  console.log(JSON.stringify({
    checked: results.length,
    failed: results.filter((r) => r.status === 'fail').length,
    closed: closedNow.map((r) => r.key),
    open: stillOpen.map((r) => ({ key: r.key, days: daysSince(r.since), what: r.what, fails: r.fails, how: r.how })),
  }, null, 2))
  process.exit(0)
}

console.log(`检查 ${results.length} 项 · 未通过 ${results.filter((r) => r.status === 'fail').length} 项 · 本次结案 ${closedNow.length} 项\n`)
for (const r of results) {
  console.log((r.status === 'ok' ? '  ✓ ' : '  ✗ ') + r.key + ' — ' + r.detail)
  if (r.status === 'fail' && r.how) console.log('      怎么修：' + r.how)
}

if (stillOpen.length) {
  console.log(`\n未结问题（${stillOpen.length}）——每次跑都会重提，检查通过即自动结案：`)
  for (const r of stillOpen) {
    const d = daysSince(r.since)
    const flag = d >= 3 ? ' 🔴' : ''
    console.log(`  [${d} 天 / 第 ${r.fails} 次]${flag} ${r.key}：${r.what}`)
  }
} else {
  console.log('\n台账是空的。')
}
