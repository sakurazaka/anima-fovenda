#!/usr/bin/env node
// raw-cold.mjs —— 把老的 raw 日文件压成 .jsonl.gz
//
// 原则：
//   · 只压缩，不删除内容；成功后原文件才移除
//   · 默认 30 天；今天的文件、最近文件不碰
//   · 不自动调度；要跑就手动跑（或你自己接定时任务）
//
// 用法：
//   node tools/raw-cold.mjs [--days 30] [--dry-run]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { P } from './paths.mjs'

const RAW = path.join(P.memory, 'raw')
const AV = process.argv.slice(2)
const dry = AV.includes('--dry-run')
const di = AV.indexOf('--days')
const days = Math.max(1, Number(di >= 0 ? AV[di + 1] : 30) || 30)
const today = new Date()
today.setHours(0, 0, 0, 0)

if (!fs.existsSync(RAW)) {
  console.log('没有 raw 目录：' + RAW)
  process.exit(0)
}

const re = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/
let compressed = 0
let skipped = 0
let bytesIn = 0
let bytesOut = 0

for (const name of fs.readdirSync(RAW).sort()) {
  const m = re.exec(name)
  if (!m) continue
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const age = Math.floor((today - d) / 86400000)
  if (age < days) { skipped++; continue }

  const src = path.join(RAW, name)
  const dst = src + '.gz'
  if (fs.existsSync(dst)) { skipped++; continue }
  if (dry) {
    console.log('[dry] ' + name + ' → ' + path.basename(dst) + '  (' + age + ' 天)')
    continue
  }

  try {
    const raw = fs.readFileSync(src)
    const gz = zlib.gzipSync(raw, { level: 9 })
    const tmp = dst + '.tmp-' + process.pid
    fs.writeFileSync(tmp, gz)
    fs.renameSync(tmp, dst)
    fs.unlinkSync(src)
    compressed++
    bytesIn += raw.length
    bytesOut += gz.length
    console.log('✓ ' + name + ' → ' + path.basename(dst) + '  ' + raw.length + ' → ' + gz.length + ' B')
  } catch (error) {
    console.error('✗ ' + name + '：' + String((error && error.message) || error))
  }
}

console.log(`raw-cold：${compressed} 个压缩，${skipped} 个跳过${dry ? '（dry-run）' : ''}` +
  (compressed ? `；${bytesIn} → ${bytesOut} B` : ''))
