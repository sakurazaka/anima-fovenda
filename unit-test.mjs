#!/usr/bin/env node
// unit-test.mjs —— 单元测试（2026-11-08 起）
//
// 为什么单开一个文件：smoke / e2e 都是黑盒（发请求、看输出）。
// 有些错黑盒抓不到 —— 它们不报错，只是结果慢慢变成错的：
//   · buildDiff 的 LCS 少一行 → 人格对比看起来"没变"
//   · parseMemo 漏一列 → 备忘表格显示错位
//   · exitDays 算错 → 界面上的"还剩几天"一直是错的
//   · personaBlockChars 算错 → "文件 N 字 / 注入 N 字"对不上，反而不报
//
// 做法：client.js 在 factory 里把纯函数挂到 window.__animaInternals（测试钩子），
//   这里用一个假的 window + 假 React 把 factory 跑起来，拿真函数来测。
//   **测的是生产代码本身，不是副本** —— 副本一定会漂移，那就白测了。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(HERE, 'plugin', 'client.js')

let pass = 0, fail = 0
const failed = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; failed.push(name); console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')) }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected })
}

// ── 把 client.js 的 factory 跑起来 ───────────────────────
function loadClient() {
  const src = fs.readFileSync(CLIENT, 'utf8')
  const captured = {}
  const fakeWindow = {
    __ModuleLoader__: { load: (def) => { captured.def = def } },
    addEventListener() { }, removeEventListener() { },
    localStorage: { getItem: () => null, setItem() { } },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
  }
  const fakeReact = {
    createElement: () => null,
    useState: (v) => [v, () => { }],
    useEffect: () => { },
    useCallback: (f) => f,
    useMemo: (f) => f(),
    useRef: () => ({ current: null }),
    Fragment: 'Fragment',
  }
  const fakeRequire = (id) => (id === 'react' ? fakeReact : {})

  // 双重保险：给 globalThis 也挂上 window，兼容 src 里可能出现的裸 window 引用
  const prevWindow = globalThis.window
  const prevInternals = globalThis.__animaInternals
  globalThis.window = fakeWindow
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'globalThis', src)(fakeWindow, globalThis)
    if (!captured.def || typeof captured.def.factory !== 'function') {
      throw new Error('没抓到 ModuleLoader.load 的 factory')
    }
    captured.def.factory(fakeRequire)
    return globalThis.__animaInternals || fakeWindow.__animaInternals || null
  } finally {
    globalThis.window = prevWindow
    if (prevInternals === undefined) delete globalThis.__animaInternals
    else globalThis.__animaInternals = prevInternals
  }
}

console.log('\n[U1] 加载 client.js 的纯函数')
let I = null
try {
  I = loadClient()
  ok('拿到测试钩子 __animaInternals', !!I)
  if (I) {
    const names = ['parseQueueLines', 'parseMemo', 'mdText', 'auditIsTableScaffold', 'buildDiff', 'exitDays', 'personaBlockChars']
    for (const n of names) ok('导出了 ' + n, typeof I[n] === 'function')
  }
} catch (error) {
  ok('加载 client.js', false, String(error.message || error))
}

if (I) {
  // ── U2 buildDiff（人格对比的 LCS）─────────────────────
  console.log('\n[U2] buildDiff —— 一致性比对')
  {
    const a = ['x', 'y', 'z']
    // 真实契约：每一行是 { l, r, tag }，tag ∈ same/del/add
    eq('完全相同 → 全 same', I.buildDiff(a, a).map((r) => r.tag), ['same', 'same', 'same'])
    const d = I.buildDiff(['a', 'b'], ['a', 'c'])
    ok('改一行 → 1 个 del + 1 个 add', d.filter((r) => r.tag === 'del').length === 1 && d.filter((r) => r.tag === 'add').length === 1, d.map((r) => r.tag))
    ok('空 vs 一行 → 只有 add', I.buildDiff([], ['a']).every((r) => r.tag === 'add'))
    ok('一行 vs 空 → 只有 del', I.buildDiff(['a'], []).every((r) => r.tag === 'del'))
    // 关键：不能把"移动"算成全部变动（否则界面会说"整个人格都变了"）
    const mv = I.buildDiff(['a', 'b', 'c'], ['c', 'a', 'b'])
    ok('移动顺序 → 至少 2 行判为 same', mv.filter((r) => r.tag === 'same').length >= 2, mv.map((r) => r.tag))
    // 补一条：行数不能丢（有 bug 时会出现 l 和 r 都为 null 的空行）
    ok('不产生空行', I.buildDiff(['a', 'b'], ['b', 'a']).every((r) => r.l !== null || r.r !== null))
  }

  // ── U3 exitDays ───────────────────────────────────────
  console.log('\n[U3] exitDays —— 出局倒计时（和 memctl 同一套参数）')
  {
    const now = Date.now()
    const day = 86400000
    const mk = (imp, ageDays, clarity = 1) => ({
      imp, clarity, at: new Date(now - ageDays * day).toISOString(), lastUsed: null,
    })
    eq('imp=5 永不出局', I.exitDays(mk(5, 400)), null)
    eq('imp=4 永不出局', I.exitDays(mk(4, 400)), null)
    ok('imp=1 刚写 → 有天数', typeof I.exitDays(mk(1, 0)) === 'number')
    // 真实语义：出局要**两道门槛同时满足**（清晰度掉到门槛 + 年龄到线），
    //   所以返回 ceil(max(清晰度还需天数, 年龄余量))。刚写的新条目是被清晰度卡住的。
    // 两道门槛取"更晚"的那个：新条目清晰度还高，真正卡住它的是 30 天年龄线
    ok('imp=1 clarity=1 刚写 → 30 天（年龄线卡住）', I.exitDays(mk(1, 0)) === 30, I.exitDays(mk(1, 0)))
    ok('imp=1 清晰度已到门槛、29 天 → 1 天（年龄卡住）', I.exitDays(mk(1, 29, 0.1)) === 1, I.exitDays(mk(1, 29, 0.1)))
    ok('imp=1 清晰度到门槛、超 30 天 → ≤ 0', I.exitDays(mk(1, 40, 0.1)) <= 0, I.exitDays(mk(1, 40, 0.1)))
    ok('imp=3 clarity=0.2 刚写 → 90 天（年龄线卡住）', I.exitDays(mk(3, 0, 0.2)) === 90, I.exitDays(mk(3, 0, 0.2)))
    ok('imp=3 已 89 天、清晰度到门槛 → 1 天', I.exitDays(mk(3, 89, 0.15)) === 1, I.exitDays(mk(3, 89, 0.15)))
  }

  // ── U4 parseMemo ──────────────────────────────────────
  console.log('\n[U4] parseMemo —— 备忘录表格')
  {
    // 真实契约：返回「小节」数组，每节里有 tables；一级标题决定待办 / 已完成两区
    const secs = I.parseMemo([
      '# 待办',
      '## A 段',
      '| # | 事 | 状态 |',
      '|---|---|---|',
      '| 1 | 切数据树 | ✅ |',
      '| 2 | 单元测试 | ⬜ |',
      '# 已完成',
      '## B 段',
      '| # | 事 | 状态 |',
      '|---|---|---|',
      '| 3 | 搬家 | ✅ |',
    ])
    // 只返回"带表格"的小节，所以 4 个标题里应该剩 2 个
    ok('只保留带表格的小节', secs.length === 2, secs.map((x) => x.title))
    const aSec = secs.find((x) => x.title === 'A 段')
    ok('A 段带表格', !!(aSec && aSec.tables.length), aSec && aSec.tables.length)
    const tbl = aSec && aSec.tables[0]
    ok('表头 = #/事/状态', !!(tbl && tbl.head.length === 3), tbl && tbl.head)
    ok('表体 2 行（分隔行被跳过）', !!(tbl && tbl.body.length === 2), tbl && tbl.body.length)
    ok('「已完成」区被打上 archive 标', secs[secs.length - 1].archive === true, secs[secs.length - 1].archive)
  }

  // ── U5 parseQueueLines ────────────────────────────────
  console.log('\n[U5] parseQueueLines —— 待审队列')
  {
    const lines = [
      JSON.stringify({ id: 'a', status: 'pending', text: 'x' }),
      JSON.stringify({ id: 'b', status: 'accepted', text: 'y' }),
      'not json',
    ]
    const r = I.parseQueueLines(lines)
    ok('pending 只算 1 条', r.pending.length === 1, r.pending.length)
    ok('decided 只算 1 条', r.decided.length === 1, r.decided.length)
    // total 是「非空行数」，不是「解析成功数」——坏行也计入，这样界面能看出有脏数据
    ok('total 计入非空行（含坏行）', r.total === 3, r.total)
    ok('坏行不进任何一栏', r.pending.length + r.decided.length === r.total - 1)
  }

  // ── U6 mdText / auditIsTableScaffold ──────────────────
  console.log('\n[U6] 文本清洗')
  {
    const t = I.mdText('**粗体** 和 `代码`')
    ok('mdText 去掉 ** 和 反引号', !t.includes('**') && !t.includes('`'), t)
    ok('表格脚手架被识别', I.auditIsTableScaffold('|---|---|') === true)
    ok('正文不被误判', I.auditIsTableScaffold('他喜欢做减法，给方案先给砍掉什么') === false)
  }

  // ── U7 personaBlockChars ──────────────────────────────
  console.log('\n[U7] personaBlockChars —— 分段字数')
  {
    const lines = ['我是谁：', '你是示例角色。', '', '性格：', '天然呆。']
    // 真实契约：返回 { 段落标题: 字数 } —— 人格页拿它显示"每块占多少"
    const m = I.personaBlockChars(lines)
    ok('返回对象', m && typeof m === 'object' && !Array.isArray(m), m)
    eq('识别出两个段落标题', Object.keys(m).sort(), ['性格', '我是谁'])   // 默认按 UTF-16 排序：性(U+6027) < 我(U+6211)
    ok('字数为正数', m['我是谁'] > 0 && m['性格'] > 0, m)
  }
}

console.log('\n' + '='.repeat(46))
console.log(`通过 ${pass} · 失败 ${fail}`)
if (fail) { console.log('失败项: ' + failed.join(' / ')); process.exitCode = 1 }
