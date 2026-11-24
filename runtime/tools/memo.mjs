#!/usr/bin/env node
// memo.mjs —— MEMO.md 的行级写入口
//
// 为什么要有它：界面要能划掉一条，但 MEMO.md 不能由插件直接写
// （那是「他的东西」，写坏了很难发现）。所以跟其他记忆文件一样：界面只调 CLI。
//
// 用法：
//   node tools/memo.mjs list                     # 列出未完成的条目（编号 / 状态 / 摘要）
//   node tools/memo.mjs set <编号> --status ✅    # 改一条的状态
//   node tools/memo.mjs set <编号> --status ⬜ --note "补一句"   # 改状态并改备注（可选）
//
// 安全：写前备份到同目录 .bak-<时间戳>；临时文件 + rename 原子替换；找不到行就拒绝。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { P } from './paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MEMO = P.memo

const STATUSES = ['⬜', '🟨', '⏸', '🅿️', '✅']

// 2026-11-14：备注以前原样拼进表格，一个 `|` 就能多出单元格、一个换行就能插进一行
// 看起来像真记录的伪造行。现在：竖线换全角、换行压成空格、限长 200。
function sanitizeNote(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '｜')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function readLines() {
  if (!fs.existsSync(MEMO)) {
    console.error('找不到 MEMO.md：' + MEMO)
    process.exit(1)
  }
  return fs.readFileSync(MEMO, 'utf8').split('\n')
}

function splitRow(line) {
  // | 2 | 事项 | 卡在哪 | ⬜ |  → 返回 { num, cells, prefix, suffix }
  const parts = line.split('|')
  if (parts.length < 4) return null
  const num = parts[1].trim()
  if (!/^\d+$/.test(num)) return null
  return { num: Number(num), parts }
}

function findRow(lines, num) {
  for (let i = 0; i < lines.length; i += 1) {
    const row = splitRow(lines[i])
    if (row && row.num === num) return { index: i, row }
  }
  return null
}

function cmdList() {
  const lines = readLines()
  const rows = []
  for (const line of lines) {
    const row = splitRow(line)
    if (!row) continue
    const cells = row.parts.slice(1, -1).map((c) => c.trim())
    const status = (cells[cells.length - 1] || '').replace(/[^\u{1F000}-\u{1FAFF}\u2190-\u21FF\u2600-\u27BF\u2B00-\u2BFF⬜🟨⏸✅]/gu, '').trim()
    rows.push({ num: row.num, status: status || '⬜', text: cells[1] || '', where: cells[2] || '' })
  }
  console.log(JSON.stringify(rows, null, 1))
}

function cmdSet(num, status, note) {
  if (!STATUSES.includes(status)) {
    console.error('--status 只能是 ' + STATUSES.join(' / '))
    process.exit(1)
  }
  const lines = readLines()
  const hit = findRow(lines, num)
  if (!hit) {
    console.error('MEMO.md 里没有编号 ' + num + '（先跑 list 看看）')
    process.exit(1)
  }

  const parts = hit.row.parts.slice()
  const last = parts.length - 2            // 末尾的空串占位不算
  const old = parts[last].trim()
  let next = old
  const found = STATUSES.filter((s) => old.includes(s))
  if (found.length) {
    for (const s of found) next = next.replace(s, status)
  } else {
    next = (next ? next + ' ' : '') + status
  }
  if (note) {
    const clean = sanitizeNote(note)
    const kept = next.replace(new RegExp('[' + STATUSES.join('') + ']', 'gu'), '').trim()
    next = (kept ? kept + ' ' : '') + status + (clean ? ' ' + clean : '')
  }
  parts[last] = ' ' + next.trim() + ' '
  const updated = parts.join('|')
  // 结构自检：写完必须还能 split 成同样多的列，否则整个表格解析会错位
  if (updated.split('|').length !== hit.row.parts.length) {
    console.error('拒绝写入：这一行会被拆成 ' + updated.split('|').length + ' 列（原本 ' + hit.row.parts.length + ' 列）')
    process.exit(1)
  }

  // 备份 + 原子替换
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const bak = MEMO + '.bak-' + stamp
  fs.copyFileSync(MEMO, bak)
  const out = lines.slice()
  out[hit.index] = updated
  const tmp = MEMO + '.tmp-' + process.pid
  fs.writeFileSync(tmp, out.join('\n'), 'utf8')
  fs.renameSync(tmp, MEMO)

  console.log(`✓ #${num} 状态 ${old || '(空)'} → ${status}${note ? ' · 备注：' + sanitizeNote(note) : ''}`)
  console.log('  备份：' + path.basename(bak))
}

const isMain = process.argv[1] && process.argv[1].endsWith('memo.mjs')
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const opt = {}
  for (let i = 1; i < rest.length; i += 2) {
    const k = String(rest[i]).replace(/^--/, '')
    if (k) opt[k] = rest[i + 1]
  }
  if (cmd === 'list') cmdList()
  else if (cmd === 'set') cmdSet(Number(rest[0]), opt.status || '✅', opt.note || '')
  else {
    console.log('用法：')
    console.log('  node tools/memo.mjs list')
    console.log('  node tools/memo.mjs set <编号> --status ⬜|🟨|⏸|✅ [--note "…"]')
  }
}
