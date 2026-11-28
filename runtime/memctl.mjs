// 记忆工具：分层记忆的增 / 衰减 / 注入 / 检索
// 用法：
//   node memctl.mjs add "内容" --imp 5 --src owner [--kind promise] [--ref "facts.md:24"]
//   node memctl.mjs inject [--budget 800]         # 打印记忆块（读到就续命）
//   node memctl.mjs decay                         # 跑一次每日衰减（幂等，按天）
//   node memctl.mjs search 关键词
//   node memctl.mjs stats
//
// 2026-11-01 修两个洞：
//   ① inject 从前没被任何地方调用 → 现在写进看片流程第 0 步
//   ② 读取从不续命 → inject 读到的条目 clarity +0.15、lastUsed 更新
//   ③ 规则改了：imp>=4 永不自动归档（只掉到 0.4 见底）；imp=3 要 90 天没被读才归档；imp<=2 仍 30 天
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P } from './tools/paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MEM = P.memory
const DECAY = P.decay
const FULL = P.full
const STATE = path.join(P.memory, 'decay-state.json')
const IMPLOG = path.join(MEM, 'imp-log.jsonl')   // 手工改 imp 的审计流水
const today = () => new Date().toLocaleDateString('sv-SE')

fs.mkdirSync(MEM, { recursive: true })

const readJsonl = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
const append = (f, obj) => fs.appendFileSync(f, JSON.stringify(obj) + '\n')

// 衰减速度：重要度越高掉得越慢
export const rate = (imp) => (imp >= 4 ? 0.02 : imp === 3 ? 0.05 : 0.1)
// 下限：重要度高的不会掉到看不见
export const floor = (imp) => (imp >= 4 ? 0.4 : imp === 3 ? 0.15 : 0)
// 归档年龄门槛（天）：imp>=4 永不自动归档，imp=3 要 90 天，imp<=2 30 天
export const exitAge = (imp) => (imp >= 4 ? Infinity : imp === 3 ? 90 : 30)
// 读取时续命
export const TOUCH_GAIN = 0.15

// 衰减一步后的 clarity（只算数值，不改状态）
export const nextClarity = (r) => Math.max(floor(r.imp), Number(r.clarity) - rate(r.imp))

// 归档门槛：必须跟 floor 对齐，否则 imp=3 永远掉不到 0.1、exitAge(3) 是死代码。
// 2026-11-28 修：原来 decay() 里写的是 exitAge(r) —— 传了整个记录，函数拿到的不是数字，
// `r >= 4` 是 NaN，于是所有条目都按 30 天走，imp>=4 的「永不」形同虚设。
// 现在抽成纯函数，参数只认 r.imp，并且可以被 test-rules 直接测。
export function shouldArchive(r, now = Date.now()) {
  const gate = Math.max(0.1, floor(r.imp))
  if (nextClarity(r) > gate) return false
  const ageMs = now - new Date(r.at).getTime()
  const ageDays = ageMs / 86400000
  return ageDays >= exitAge(r.imp)
}
const ageDays = (r) => (Date.now() - new Date(r.lastUsed || r.at).getTime()) / 86400000

function add(text, { imp = 2, src = 'manual', kind = 'event', ref = null, by = null, fromPending = false } = {}) {
  // 2026-11-22 软闸：衰减层是「热层」（会被注入），进它必须经过待审，或他本人点头。
  // 为什么不是硬闸：他明说「这条特别」时还要能直接记；堵死会把这条路也堵掉。
  const who = String(by || '').trim()
  if (!fromPending && who !== 'owner') {
    const err = new Error(
      '拒绝：memctl add 不能直写衰减层（2026-11-22 软闸）。\n' +
      '  想记东西 → 走待审：node tools/pending.mjs add "…" --type 事实|偏好|承诺|推断 --src "来源"\n' +
      '  他本人要绕过 → memctl.mjs add "…" --by owner\n' +
      '  （待审收进来的会自动带 --from-pending，不用你管）',
    )
    err.code = 'ANIMA_GATE'
    throw err
  }
  const at = new Date().toISOString()
  const rec = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at, text, imp, src, kind, clarity: 1.0, lastUsed: at, state: 'active' }
  if (ref) rec.ref = String(ref)   // 派生层回指：这条是从哪个主文件的哪一处来的（2026-11-11）
  append(FULL, { ...rec, archivedAt: at })          // 先归档，永不丢
  append(DECAY, rec)                                 // 再进衰减层
  return rec
}

function decay() {
  const st = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} } })()
  if (st.lastRun === today()) { console.log('今天已经衰减过'); return }
  const rows = readJsonl(DECAY)
  const out = []
  let faded = 0
  for (const r of rows) {
    // 已经归档的条目不再反复计算；它仍在 decay 文件里，可查、可恢复
    if (r.state === 'archived') { out.push(r); continue }
    const next = nextClarity(r)
    if (shouldArchive(r)) {
      faded += 1
      // 2026-11-10 #66：归档不删除，改成 archived；仍在 decay 档，注入跳过。
      out.push({ ...r, clarity: Number(next.toFixed(2)), state: 'archived', archivedAt: new Date().toISOString() })
      continue
    }
    out.push({ ...r, clarity: Number(next.toFixed(2)), state: 'active' })
  }
  writeJsonl(DECAY, out)
  fs.writeFileSync(STATE, JSON.stringify({ lastRun: today() }))
  console.log(`衰减完成：${rows.length} 条 → 归档 ${faded} 条（仍在 decay 档，不再注入）`)
}

// 2026-11-07：注入排序加「新近性 + 每档配额」。
// 原来只按 imp×clarity 排，53 条同分 imp5 里永远取最早那几条 —— 昨天写的进不来，
// 而这一层的定位明明是「最近该记得的事」。
const TIER_CAP = { 5: 0.5, 4: 0.35, 3: 0.15, 2: 0, 1: 0 }   // 各档最多吃掉预算的多少；2/1 档不占名额

// 新近性只认「这件事什么时候发生」（at），不认 lastUsed —— 后者会被注入本身刷新，
// 拿它算新近性会形成「被注入 → 变新鲜 → 又被注入」的自我强化闭环。
function freshness(r, now = Date.now()) {
  const t = Date.parse(r.at || 0) || 0
  if (!t) return 0
  const age = Math.max(0, (now - t) / 86400000)
  return 0.6 * Math.exp(-age / 14)      // 14 天后剩 37%，30 天后约 7%
}

function scoreOf(r, now = Date.now()) {
  return (Number(r.imp) || 0) * (Number(r.clarity) || 0) * (1 + freshness(r, now))
}

function inject(budget = 800) {
  // 2026-11-28 修：这里以前是 readJsonl(DECAY).filter(非归档)，然后又把这个结果整个写回文件，
  // 于是每跑一次 inject，归档条目就从 decay.jsonl 里被物理删掉——「归档不删除、可恢复」形同虚设
  // （11-28 19:35 那次就删掉了 22 条）。现在整份读进来，只在写回时改被读到的条目。
  const rowsAll = readJsonl(DECAY)
  const all = rowsAll.filter((r) => r.state !== 'archived')
  const now = Date.now()
  const rows = all
    .filter((r) => r.clarity > 0.1 && (TIER_CAP[r.imp] ?? 0) > 0)
    .sort((a, b) => scoreOf(b, now) - scoreOf(a, now))

  const out = []
  const touched = new Set()
  const usedByImp = {}
  let used = 0

  const lineOf = (r) => `- ${r.clarity < 0.3 ? '（记不太清）' : ''}${r.text}`
  const take = (r, respectCap) => {
    if (touched.has(r.id)) return
    const line = lineOf(r)
    if (used + line.length > budget) return
    if (respectCap) {
      const cap = (TIER_CAP[r.imp] ?? 0) * budget
      if ((usedByImp[r.imp] || 0) + line.length > cap) return
    }
    out.push(line); used += line.length; touched.add(r.id)
    usedByImp[r.imp] = (usedByImp[r.imp] || 0) + line.length
  }

  for (const r of rows) take(r, true)    // 第一遍：守配额，保证 imp4 / imp3 有名额
  for (const r of rows) take(r, false)   // 第二遍：预算还有剩就放宽，别浪费

  // 续命：读到的条目 clarity 回升，lastUsed 刷新
  if (touched.size) {
    const stamp = new Date().toISOString()
    // 整份写回：归档条目原样带过去，一个都不少
    const updated = rowsAll.map((r) => touched.has(r.id)
      ? { ...r, clarity: Number(Math.min(1, Number(r.clarity) + TOUCH_GAIN).toFixed(2)), lastUsed: stamp }
      : r)
    writeJsonl(DECAY, updated)
  }
  const mix = Object.keys(usedByImp).sort((a, b) => b - a)
    .map((k) => `imp${k} ${usedByImp[k]}字`).join(' / ')
  console.log(`【记忆 ${out.length} 条 / ${used} 字 · ${mix || '空'} · 续命 ${touched.size} 条】\n` + out.join('\n'))
}

function search(kw) {
  const hits = readJsonl(FULL).filter((r) => r.text.includes(kw))
  console.log(`命中 ${hits.length} 条：`)
  for (const h of hits.slice(-20)) console.log(`  [${h.at.slice(0, 10)}] ${h.text}`)
}

function find(kw) {
  if (!kw) { console.log('要搜什么？'); return }
  let n = 0
  const hit = (tag, line, where) => { n += 1; console.log(`  [${tag}] ${where}\n      ${line.trim().slice(0, 160)}`) }
  for (const r of readJsonl(DECAY)) if (r.text.includes(kw)) hit('衰减', r.text, r.at.slice(0, 10) + ' imp=' + r.imp + ' clarity=' + r.clarity)
  const seen = new Set()
  for (const r of readJsonl(FULL)) {
    if (!r.text.includes(kw) || seen.has(r.id)) continue
    seen.add(r.id); hit('全量', r.text, r.at.slice(0, 10))
  }
  // 日记目录（可选）：有几本翻几本，不假设文件名
  const diaryDir = path.join(MEM, 'diary')
  if (fs.existsSync(diaryDir)) {
    for (const name of fs.readdirSync(diaryDir).filter((n) => n.endsWith('.md')).sort()) {
      const p = path.join(diaryDir, name)
      const lines = fs.readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => { if (line.includes(kw)) hit('日记', line, `memory/diary/${name}:${i + 1}`) })
    }
  }
  console.log(n ? `\n共 ${n} 处` : '没找到')
}

// 手工改 imp —— 只改"意图"，不改正文；每一次都记审计。
// 为什么允许人改：imp 是我给的估计，估错了人有权纠正。
// 为什么不许改 clarity：那是系统状态（被读到就 +0.15），手改会破坏「读得多活得久」的语义。
function lifeOf(imp) {
  if (imp >= 4) return '永不归档（floor 0.40）'
  if (imp === 3) return '90 天未读归档（floor 0.15）'
  return '30 天未读归档（floor 0）'
}

function setImp(id, nextImp, why) {
  if (!id) { console.error('要改哪一条？用法：memctl imp <id> --imp N [--why "为什么"]'); process.exit(1) }
  const imp = Number(nextImp)
  if (!Number.isInteger(imp) || imp < 1 || imp > 5) { console.error('--imp 只能是 1-5 的整数'); process.exit(1) }

  const rows = readJsonl(DECAY)
  const r = rows.find((x) => x.id === id)
  if (!r) { console.error('衰减层里没有这条：' + id); process.exit(1) }

  const from = r.imp
  if (from === imp) { console.log('本来就是 imp=' + imp + '，没改'); return }

  r.imp = imp
  if (r.state === 'archived') { r.state = 'active'; delete r.archivedAt }
  writeJsonl(DECAY, rows)
  append(IMPLOG, { at: new Date().toISOString(), id, from, to: imp, why: why || null, text: String(r.text).slice(0, 120) })

  console.log(`✓ imp ${from} → ${imp}  ${id}`)
  console.log(`  寿命：${lifeOf(from)} → ${lifeOf(imp)}`)
  console.log(`  注入权重：${from}×clarity → ${imp}×clarity（会挤占 800 字预算）`)
}

function stats() {
  const d = readJsonl(DECAY)
  const f = readJsonl(FULL)
  const active = d.filter((r) => r.state !== 'archived')
  const archived = d.length - active.length
  const gray = active.filter((r) => r.clarity < 0.3).length
  const byImp = {}
  for (const r of active) byImp[r.imp] = (byImp[r.imp] || 0) + 1
  let last = '从未'
  try { last = JSON.parse(fs.readFileSync(STATE, 'utf8')).lastRun || '从未' } catch {}
  console.log(`衰减层 ${d.length} 条（活跃 ${active.length} · 归档 ${archived} · 标灰 ${gray}）· 全量档 ${f.length} 条 · 最后衰减 ${last}`)
  console.log('按重要度（活跃）：' + JSON.stringify(byImp) + '  （imp≥4 不会再自动归档；归档不再注入）')
}

const isMain = process.argv[1] && process.argv[1].endsWith('memctl.mjs')
const [cmd, ...rest] = process.argv.slice(2)
if (isMain) {
if (cmd === 'add') {
  const text = rest[0]
  const opt = {}
  for (let i = 1; i < rest.length; i += 1) {
    const raw = String(rest[i])
    if (raw === '--from-pending') { opt.fromPending = true; continue }   // 布尔开关，不吃下一个参数
    if (raw.startsWith('--')) { opt[raw.slice(2)] = rest[i + 1]; i += 1; continue }
    opt[raw] = rest[i]
  }
  try {
    const rec = add(text, {
      imp: Number(opt.imp) || 2,
      src: opt.src || 'manual',
      kind: opt.kind || 'event',
      ref: opt.ref || null,
      by: opt.by || null,
      fromPending: opt.fromPending === true,
    })
    console.log('已记：' + rec.id)
  } catch (e) {
    if (e.code === 'ANIMA_GATE') { console.error(e.message); process.exit(1) }
    throw e
  }
} else if (cmd === 'inject') {
  const i = rest.indexOf('--budget'); inject(i >= 0 ? Number(rest[i + 1]) : 800)
} else if (cmd === 'decay') decay()
else if (cmd === 'imp') {
  const opt = {}
  for (let i = 1; i < rest.length; i += 2) {
    const k = String(rest[i]).replace(/^--/, '')
    if (k) opt[k] = rest[i + 1]
  }
  const idArg = rest[0] && rest[0].startsWith('--') ? opt.id : rest[0]
  setImp(idArg, opt.imp, opt.why)
}
else if (cmd === 'search') search(rest[0] || '')
else if (cmd === 'find') find(rest[0] || '')
else if (cmd === 'stats') stats()
else console.log('用法: add / inject [--budget N] / decay / imp <id> --imp N [--why "…"] / search / find / stats')
}
