// paths.mjs —— 全系统的路径唯一入口
//
// 为什么要有它：路径以前散落在 8 个脚本里，各自拼用户目录或 `here/..`。想搬一次数据目录，就得改 8 处，而且漏一处不会报错 ——
// 只会让某个脚本悄悄读旧位置。
//
// 解析规则（就三条）：
//   DATA     环境变量 ANIMA_DATA   → 否则 paths.mjs 的上一层目录
//   IDENTITY 环境变量 ANIMA_IDENTITY → 否则 <DATA>/identity
//   DSH      环境变量 DSH_HOME     → 否则 <HOME>/.dsh
//
// **默认值都是相对的**：把整个目录搬走（或者第三方首次部署），只要 paths.mjs 跟着走，
// 默认值自己就对了，不用改代码。
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)) // <DATA>/tools

export const HOME = process.env.USERPROFILE || process.env.HOME || '.'

export const DATA = process.env.ANIMA_DATA
  ? path.resolve(process.env.ANIMA_DATA)
  : path.resolve(here, '..')

// 身份层：优先 ANIMA_IDENTITY；否则 <DATA>/identity（自包含布局）。
// 这条让"整个文件夹搬走就能跑"成立 —— 不用再单独设 ANIMA_IDENTITY。
export const IDENTITY = (() => {
  if (process.env.ANIMA_IDENTITY) return path.resolve(process.env.ANIMA_IDENTITY)
  return path.join(DATA, 'identity')
})()

export const DSH = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(HOME, '.dsh')

export const P = {
  // 记忆
  memory: path.join(DATA, 'memory'),
  self: path.join(DATA, 'memory', 'self'),
  selfMd: path.join(DATA, 'memory', 'self', 'self.md'),
  voicesMd: path.join(DATA, 'memory', 'self', 'voices.md'),
  facts: path.join(DATA, 'memory', 'facts.md'),
  ops: path.join(DATA, 'memory', 'ops.md'),
  handoff: path.join(DATA, 'memory', 'handoff'),   // 目录：一个项目一份（2026-11-24 起，不再是单文件）
  role: path.join(DATA, 'memory', 'role.md'),
  personaLog: path.join(DATA, 'memory', 'persona.log'),
  snapshots: path.join(DATA, 'memory', 'persona.snapshots'),
  index: path.join(DATA, 'memory', 'index', 'mem.db'),
  decay: path.join(DATA, 'memory', 'decay.jsonl'),
  full: path.join(DATA, 'memory', 'full.jsonl'),
  pendingFacts: path.join(DATA, 'memory', 'pending-facts.jsonl'),
  impLog: path.join(DATA, 'memory', 'imp-log.jsonl'),
  daily: path.join(DATA, 'memory', 'daily'),
  // 顶层文档
  memo: path.join(DATA, 'MEMO.md'),
  changelog: path.join(DATA, 'CHANGELOG.md'),
  // 脚本与备份
  tools: path.join(DATA, 'tools'),
  backup: path.join(DATA, 'backup'),
  // 身份与纪律
  persona: path.join(IDENTITY, 'persona.md'),
  rules: path.join(IDENTITY, 'rules.md'),
}

// 自检：node paths.mjs
// 供别的语言调用：node paths.mjs --json   （mem-index.py 用它，避免在 python 里再写一份解析）
if (process.argv[1] && process.argv[1].endsWith('paths.mjs')) {
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ HOME, DATA, IDENTITY, DSH, P }, null, 2))
    process.exit(0)
  }
  console.log('DATA     ' + DATA)
  console.log('IDENTITY ' + IDENTITY)
  console.log('DSH      ' + DSH)
  console.log('')
  for (const [k, v] of Object.entries(P)) {
    let mark = ' '
    try {
      const fs = await import('node:fs')
      mark = fs.existsSync(v) ? '✓' : '✗'
    } catch {}
    console.log('  ' + mark + ' ' + k.padEnd(13) + v)
  }
}
