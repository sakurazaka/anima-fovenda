// check-package.mjs —— 发布包自洽检查（仓库自用，不进包）
//
// 为什么要有它：0.2.6 把 client.js 的注册 id 写成了 `@local/anima-fovenda`，
// 而 package name 和 bundle id 都是 `anima-fovenda`；客户端加载器按 name 查注册，
// 查不到就报错。本地看不出问题（现役部署本来就该用 @local），只有第三方装上去才会炸。
//
// 用法：node tools/check-package.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED = [
  'package.json',
  'plugin/index.js',
  'plugin/client.js',
  'plugin/cordis.patch.yml',
  'runtime/memctl.mjs',
  'runtime/tools/pending.mjs',
  'runtime/tools/paths.mjs',
  'runtime/tools/mem-index.py',
  'unit-test.mjs',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'LICENSE',
  'SECURITY.md',
]

// 发布包不该夹带真实数据或机器痕迹。
// 注意：@local/ 不在此列——文档和注释里会拿它举例；真正要防的是「client 注册 id 带 @local」，下面单独判。
const FORBIDDEN = [/\bVIRIDIA\b/, /C:\\Users\\/i]
const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.json', '.yml', '.yaml', '.html', '.svg'])

let fail = 0
const ok = (cond, label, extra = '') => {
  console.log((cond ? '✓ ' : '✗ ') + label + (cond ? '' : '  ← ' + extra))
  if (!cond) fail += 1
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const pluginPkg = JSON.parse(fs.readFileSync(path.join(root, 'plugin/package.json'), 'utf8'))
const client = fs.readFileSync(path.join(root, 'plugin/client.js'), 'utf8')
const patch = fs.readFileSync(path.join(root, 'plugin/cordis.patch.yml'), 'utf8')

const clientId = (client.match(/__ModuleLoader__\.load\(\{[\s\S]{0,300}?id:\s*'([^']+)'/) || [])[1]
const bundleId = (patch.match(/-\s*id:\s*(\S+)/) || [])[1]

ok(pkg.name && !pkg.name.startsWith('@local/'), '包名不带 @local/ 前缀', pkg.name)
ok(pkg.name === pluginPkg.name, '两个 package.json 的 name 一致', `${pkg.name} / ${pluginPkg.name}`)
ok(clientId === pkg.name, 'client.js 注册 id == package name', `client=${clientId} name=${pkg.name}`)
ok(bundleId === pkg.name, 'cordis bundle id == package name', `bundle=${bundleId} name=${pkg.name}`)
ok(!String(clientId || '').startsWith('@local/'), '发布客户端不能用 @local/ 前缀', String(clientId))

for (const f of REQUIRED) ok(fs.existsSync(path.join(root, f)), '存在：' + f)

// 机器痕迹扫描（跳过仓库自用的 tools/、.github/、.git/）
const skip = new Set(['.git', '.github', 'node_modules', 'tools'])
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name)
  if (d.isDirectory()) return skip.has(d.name) ? [] : walk(p)
  return [p]
})
const files = walk(root)
let hits = 0
for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f).toLowerCase())) continue
  const text = fs.readFileSync(f, 'utf8')
  for (const rx of FORBIDDEN) {
    if (rx.test(text)) { ok(false, '含敏感/机器痕迹：' + path.relative(root, f), String(rx)); hits += 1 }
  }
}
if (!hits) ok(true, '无机器痕迹（扫描 ' + files.length + ' 个文件）')

// 打包时不该带上的东西
for (const dir of ['node_modules', 'data', 'memory']) {
  ok(!fs.existsSync(path.join(root, dir)), '不应存在：' + dir)
}

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
