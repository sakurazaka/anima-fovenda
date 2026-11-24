// 规则回归测试：衰减规则 + 待审队列的闸
//
// 为什么：2026-11-03 一整天的事故都是「改了但没人验」。
// 这个文件就是那条验——**改坏了自己会红**。
//
// 用法：node test-rules.mjs
//
// 2026-11-14：以前直接继承当前环境跑，只要设过 ANIMA_DATA（README 要求的部署方式），
// 这脚本就会往**真实队列**里写一条「自检用」。现在强制隔离到 mkdtemp，跑完删除。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rate, floor, exitAge, TOUCH_GAIN } from '../memctl.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath
const REAL_DATA = process.env.ANIMA_DATA ? path.resolve(process.env.ANIMA_DATA) : path.resolve(here, '..')
const TEST_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-test-'))
if (path.resolve(TEST_DATA) === path.resolve(REAL_DATA)) {
  console.error('拒绝运行：测试数据根与真实数据根相同（' + REAL_DATA + '）')
  process.exit(2)
}
const cleanup = () => { try { fs.rmSync(TEST_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) } catch {} }
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })
console.log('测试数据根：' + TEST_DATA + '（真实根 ' + REAL_DATA + ' 不会被碰）')

let fail = 0
const ok = (cond, label, extra = '') => {
  console.log((cond ? '✓ ' : '✗ ') + label + (cond ? '' : '  ' + extra))
  if (!cond) fail += 1
}

// ── 一、衰减规则 ─────────────────────────────
ok(rate(5) === 0.02 && rate(4) === 0.02, 'imp≥4 每天只掉 0.02', 'got ' + rate(5))
ok(rate(3) === 0.05, 'imp=3 每天掉 0.05', 'got ' + rate(3))
ok(rate(2) === 0.1 && rate(1) === 0.1, 'imp≤2 每天掉 0.1', 'got ' + rate(2))
ok(floor(5) === 0.4 && floor(4) === 0.4, 'imp≥4 下限 0.4')
ok(floor(3) === 0.15, 'imp=3 下限 0.15')
ok(floor(2) === 0, 'imp≤2 无下限')
ok(exitAge(5) === Infinity && exitAge(4) === Infinity, 'imp≥4 永不自动出局')
ok(exitAge(3) === 90, 'imp=3 要 90 天没被读才出局')
ok(exitAge(2) === 30, 'imp≤2 30 天')
ok(TOUCH_GAIN === 0.15, '读取续命 +0.15')

// 模拟：imp5 连续衰减 200 天，不能掉出可见范围
const decay = (imp, days) => {
  let c = 1
  for (let i = 0; i < days; i++) c = Math.max(floor(imp), c - rate(imp))
  return c
}
ok(decay(5, 200) >= 0.4, 'imp=5 衰减 200 天后仍 ≥0.4', 'got ' + decay(5, 200))
ok(decay(3, 200) >= 0.15, 'imp=3 衰减 200 天后仍 ≥0.15', 'got ' + decay(3, 200))
ok(decay(2, 30) <= 0.1, 'imp=2 30 天后确实会变淡', 'got ' + decay(2, 30))

// ── 二、待审队列的闸 ─────────────────────────
const pending = path.join(here, 'pending.mjs')
const run = (args) => {
  try {
    return { code: 0, out: execFileSync(NODE, [pending, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ANIMA_DATA: TEST_DATA },
    }) }
  } catch (e) {
    return { code: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

const noSrc = run(['add', '没有来源的条目'])
ok(noSrc.code !== 0, '没给 --src 的条目被拒', 'code=' + noSrc.code)

const badType = run(['add', '类型不对的条目', '--type', '随便', '--src', '测试'])
ok(badType.code !== 0, '非法 --type 被拒', 'code=' + badType.code)

// 文本带时间戳：同一条测试不能因为上次留下的 rejected 记录被去重跳过
const stamp = new Date().toISOString()
const good = run(['add', '【测试】待审队列自检条目 ' + stamp, '--type', '事实', '--src', 'test-rules.mjs 自动写入'])
ok(good.code === 0 && /已入待审/.test(good.out), '合法条目进队列', good.out.trim())

const id = (good.out.match(/p[a-z0-9]+/) || [])[0]
if (id) {
  // 11-08 起收/扔必须带 --by
  const rej = run(['reject', id, '--reason', '自检用，扔掉', '--by', 'owner'])
  ok(rej.code === 0, '可以扔掉（带理由）', rej.out.trim())
  const again = run(['reject', id, '--reason', '重复处理', '--by', 'owner'])
  ok(again.code !== 0, '同一条不能被处理两次', 'code=' + again.code)
} else {
  ok(false, '拿不到刚入队的 id')
}

console.log(fail ? `\n有 ${fail} 条失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
