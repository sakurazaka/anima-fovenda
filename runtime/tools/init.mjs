#!/usr/bin/env node
// init.mjs —— 在一个空目录里建出合法的数据树
//
// 用途：第三方 git clone 之后，一条命令就有个能跑的空系统；
// 或者你自己想在别处开一个干净的实验环境。
//
// 用法：
//   node tools/init.mjs <目标目录>          # 建数据树
//   node tools/init.mjs <目标目录> --force  # 目录非空也照建（不覆盖已有文件）
//
// 只创建，不删除、不覆盖任何已存在的文件。
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const target = args.find((a) => !a.startsWith('--'))
const force = args.includes('--force')

if (!target) {
  console.error('用法: node tools/init.mjs <目标目录> [--force]')
  process.exit(1)
}

const ROOT = path.resolve(target)
if (fs.existsSync(ROOT) && fs.readdirSync(ROOT).length && !force) {
  console.error('目录非空：' + ROOT + '（加 --force 才继续，仍然不覆盖已有文件）')
  process.exit(1)
}

let created = 0
let skipped = 0

function ensureDir(p) {
  if (fs.existsSync(p)) { skipped += 1; return }
  fs.mkdirSync(p, { recursive: true })
  created += 1
}

function seed(p, content) {
  if (fs.existsSync(p)) { skipped += 1; return }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
  created += 1
}

const DIRS = [
  'identity',
  'memory',
  'memory/self',
  'memory/persona.snapshots',
  'memory/index',
  'memory/daily',
  'memory/timeline',
  'memory/handoff',
  'memory/.pre-route',
  'backup',
  'tools',
]

const FILES = {
  // 身份层也由 init 生成，包里不再带 0 字节模板（2026-11-25）
  'identity/persona.md': '',
  'identity/rules.md': '',
  'memory/decay.jsonl': '',
  'memory/full.jsonl': '',
  'memory/pending-facts.jsonl': '',
  'memory/imp-log.jsonl': '',
  'memory/decay-state.json': JSON.stringify({ lastRun: null }, null, 2) + '\n',
  'memory/facts.md': [
    '# 长期记忆（facts）',
    '',
    '> 只收「能对得上账」的事件：有日期、有原话、有具体场景。',
    '> 形容词会被演成表演；事情会被当成记忆。',
    '',
    '## 关于用户',
    '',
    '- ',
    '',
    '## 背景与约定',
    '',
    '- ',
    '',
  ].join('\n'),
  'memory/self/self.md': [
    '# 我学到的（self）',
    '',
    '## 一、失败模式',
    '',
    '- ',
    '',
    '## 二、我学到的',
    '',
    '- ',
    '',
  ].join('\n'),
  'memory/self/voices.md': [
    '# 他的原话（voices）',
    '',
    '> 只收原话，不做转述。重复本身是强调。',
    '',
    '## 对我的要求',
    '',
    '| 日期 | 原话 | 情境 |',
    '|---|---|---|',
    '',
  ].join('\n'),
  'memory/ops.md': [
    '# 运维备忘（ops）',
    '',
    '> 按需查标题，别整本读。',
    '',
  ].join('\n'),
  // 交接包是目录（2026-11-24 起，一个项目一份）；不再生成单文件 memory/handoff.md
  'memory/handoff/README.md': [
    '# 交接包（handoff）',
    '',
    '> 换新会话时，开场只读这里。',
    '> 一个项目一份：`<项目名>.md`，例如 `anima-fovenda.md`。',
    '> 只写「目标 / 现在卡在哪 / 下一步 / 相关文件」，不写过程。',
    '',
  ].join('\n'),
  'MEMO.md': [
    '# 备忘（MEMO）',
    '',
    '> 记「还没办完 / 还没想好的事」。不是任务板。',
    '',
    '## A. 等你拍板',
    '',
    '| # | 事项 | 卡在哪 | 状态 |',
    '|---|---|---|---|',
    '',
  ].join('\n'),
  'CHANGELOG.md': [
    '# 系统级改动记录',
    '',
    '> 只收跨模块、或会静默改变每天行为的改动。',
    '',
  ].join('\n'),
}

ensureDir(ROOT)
for (const d of DIRS) ensureDir(path.join(ROOT, d))
for (const [rel, content] of Object.entries(FILES)) seed(path.join(ROOT, rel), content)

console.log('数据树：' + ROOT)
console.log('  新建 ' + created + ' 项 · 跳过 ' + skipped + ' 项（已存在）')
console.log('')
console.log('下一步：')
console.log('  1) 把 tools/ 和 memctl.mjs 复制进来（或让 ANIMA_DATA 指向这里的同时保留代码在原处）')
console.log('  2) 设环境变量让程序用这棵树：')
console.log('       ANIMA_DATA=' + ROOT)
console.log('  3) 自检：node ' + path.join(ROOT, 'tools', 'paths.mjs'))
