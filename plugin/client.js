/**
 * Anima Fovenda（记忆审阅台）· Client 半边
 *
 * 一个 `main` 面板 + 一个 `sidebar.panellist` 图标。
 * 数据走 host 注册的 /anima-fovenda/api，动作也走它（host 那边 spawn CLI）。
 */
window.__ModuleLoader__.load({
  // 必须与 package.json 的 name、cordis.patch.yml 的 bundle id 一致（`anima-fovenda`）。
  // 现役部署那份用的是 `@local/anima-fovenda`（profile 里按这个名 link），
  // 但发布包不能带 `@local/` 前缀 —— 否则客户端加载器按 name 查注册会查不到（0.2.6 的事故）。
  id: 'anima-fovenda',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback

    // ── 可见文案 ─────────────────────────────────────────
    // 改字只动这里，别去 1500 行里散着找。{x} 是占位符，用 fmt 填。
    const fmt = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] == null ? '' : vars[k]))
    const COPY = {
      tabs: { pending: '待审', persona: '人格', rules: '规则', memory: '记忆', memo: '备忘', search: '检索' },
      common: { refresh: '刷新', refreshing: '刷新中…', loading: '读文件中…', save: '保存', saving: '保存中…', reset: '还原', reload: '重新加载' },
      pending: {
        title: '待审',
        sub: '每条先决定去处：收进衰减层 / 收进长期（选文件和小节）/ 升为常驻只预览 / 扔掉。收进衰减时可以改 imp：agent 的权重只是建议，最终以你选的为准。记忆文件一律走 CLI（pending.mjs）写，界面不直接碰；只有下面两类例外：「规则」页直接写 rules.md、「备忘」页经 memo.mjs 改状态。右栏是自检。',
        entryTitle: '什么会进待审',
        entryIntro: '插件只提供队列和收/扔，不决定什么时候投料；投料由使用者的 agent / CLI 决定。下面是常见判据。',
        entry1: '他明确说「记住 / 以后 / 别再 / 规矩」，但没指定放哪一层。',
        entry2: '一条结论以后用得上，但不确定该放 facts / self / voices 哪一层。',
        entry3: '我发现自己反复犯同一个错，还没想好该写成什么规则。',
        entryNo: '不投：事实性对话、天气、哪条视频好看、一次性情绪；已经有明确落点的；这次已经直接写进某层的。',
        entryPolicy: '来源必填（--src）；收/扔由人决定。插件不投料，也没有默认定时任务。',
        empty: '暂无',
        emptyDone: '暂无',
      },
      search: {
        title: '检索',
        lead: '全文检索：文档、日记（如果有）、会话、衰减层、失败模式、原话都在里面。规范层（原话 / 我学到的 / 规则）有加权，体量大的日记和会话会被压一点。',
        placeholder: '比如：他说过不用附和 / 自我归罪 / 录音器 bug',
        button: '搜',
        busy: '搜…',
        empty: '没命中。换个词试试，或者用更短的词。',
      },
      rules: {
        title: '规则',
        lead: '每轮注入系统提示的一段纪律，和人格平级但分开。改的是「我怎么做」写这里；改完保存即可 —— 不用同步、不用重启，下一条消息生效。',
        placeholder: '一行一条。比如：报告里不许出现「希望对你有帮助」。',
        footer: '规则单独一段，每轮注入；改它不用碰人格。总长建议 ≤ 600 字，超过 1200 字会报警（每轮都在付费）。',
        buttonHint: '还原 = 放弃草稿，回到已保存的版本；重新加载 = 从磁盘重读，未保存的草稿会丢。',
        loading: '读规则…',
      },
      memo: {
        title: '备忘',
        lead: '他还没办完、还没想好的事。状态可以直接在这里改（写入口是 tools/memo.mjs：自动备份 + 原子替换）。',
        lead2: '状态含义：⬜ 未做 · 🟨 部分（做了但不完整）· ⏸ 搁置（等条件）· ✅ 完成。改完立刻写回 MEMO.md，那一条会按新状态归到「已完成」或留在待办区。',
        loading: '读备忘…',
      },
      persona: {
        title: '人格',
        lead: '上半：左边是选中的快照，右边是当前的 persona 源文件 —— 改人格之前先看这里，多了什么、少了什么。注意：本页展示的始终是 identity/persona.md，它不一定会进系统提示 —— 取决于部署（personaPrefix 编译进配置 / ANIMA_PERSONA_SECTION=1 由插件注入 / 都不设则只展示）。下半：常驻构成。改的是「我是谁」写这里；改「我怎么做」去规则页。',
      },
      memory: {
        title: '记忆',
        pageLead: '这一页看两层：衰减层是带权重、会归档的日常记忆；长期层是 facts / self / voices，只读。imp 越高越重要、越抗衰减，低 imp 才会先归档；标签颜色按危险度走：蓝/青=稳，灰=中间，橙/红=接近归档。写入口仍然只走 pending.mjs / memctl.mjs。',
        decayTitle: '记忆',
        lead: '共 {n} 条，其中活跃 {active} 条、归档 {archived} 条；imp ≥ 4 的 {strong} 条永不自动归档，被读到会续命，久不读会掉清晰度。',
        lead2: '「距归档」列按 memctl 的规则算：clarity 掉到门槛、且满足年龄条件，才移出活跃层（仍在 decay 档，不再注入）。门槛是 max(0.1, 该档下限)：imp≤2 是 0.1（30 天）、imp3 是 0.15（90 天）、imp≥4 永不。现在会归档的是 {expiring} 条。',
        lead3: '左边那个数字可以改：imp 是我给的估计，估错了你直接调。改它有两个后果 —— 寿命（掉多快、会不会归档）和注入优先级（会挤占注入预算；本机是每天一次的自动化任务按 800 字注入，其他部署按自己的注入配置）。每次改动都记在 imp-log.jsonl。',
        loading: '读衰减层…',
        longLead: '只读。facts / self / voices 的正文；写入口仍然只走 pending.mjs / memctl.mjs。',
        longHow: '不会每轮自动注入。facts 是小文件、整本读，agent 在提方案/反驳前读；facts 不进索引。self / voices 进检索索引，recall 命中或自查时读。正常写法是待审页「收进长期」→ pending.mjs；这里只读，不提供编辑。',
        decayTab: '衰减层',
        longTab: '长期层',
      },
      audit: {
        howto: '怎么处理：跨文件重复 → 留一个主文件，另一处改成指针或删掉；同文件重复 → 合并到一个小节。这里只读，不会自动改。',
      },
    }

    const API = '/anima-fovenda/api'

    // 页头图标：只帮助定位，不放进 tab / 按钮
    const icon = (children) => h('svg', {
      viewBox: '0 0 20 20', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    }, children)
    const PAGE_ICONS = {
      pending: () => icon([
        h('path', { key: 'a', d: 'M3 10h3l1.5 2h5L14 10h3' }),
        h('path', { key: 'b', d: 'M3 10l2-5h10l2 5v4H3z' }),
      ]),
      persona: () => icon([
        h('circle', { key: 'a', cx: 10, cy: 7, r: 3 }),
        h('path', { key: 'b', d: 'M4 17c0-3 2.6-5 6-5s6 2 6 5' }),
      ]),
      rules: () => icon([
        h('rect', { key: 'a', x: 4, y: 3, width: 12, height: 14, rx: 2 }),
        h('path', { key: 'b', d: 'M7 7h6M7 10h6M7 13h4' }),
      ]),
      memory: () => icon([
        h('path', { key: 'a', d: 'M10 3l7 3.5-7 3.5-7-3.5L10 3z' }),
        h('path', { key: 'b', d: 'M3 10l7 3.5 7-3.5' }),
        h('path', { key: 'c', d: 'M3 13.5l7 3.5 7-3.5' }),
      ]),
      memo: () => icon([
        h('path', { key: 'a', d: 'M6 3h8v14l-4-3-4 3z' }),
        h('path', { key: 'b', d: 'M8 7h4' }),
      ]),
      search: () => icon([
        h('circle', { key: 'a', cx: 9, cy: 9, r: 4.5 }),
        h('path', { key: 'b', d: 'M13 13l3.5 3.5' }),
      ]),
    }
    function PageHeading(props) {
      return h('h2', { className: 'sc-h2 sc-page-h' },
        h('span', { className: 'sc-h-icon', 'aria-hidden': 'true' }, PAGE_ICONS[props.name] ? PAGE_ICONS[props.name]() : null),
        props.children)
    }

    function apiGet(params) {
      const qs = Object.keys(params).map((k) => k + '=' + encodeURIComponent(params[k])).join('&')
      return fetch(API + '?' + qs, { headers: { Accept: 'application/json' } }).then((r) => r.json())
    }

    function apiPost(body) {
      return fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json())
    }

    /**
     * 队列文件按行解析。这条为什么在 client 上：
     * host 侧的改动要重启整个 harness 才生效（模块级），而这两个小功能不值得打断会话。
     * 队列就几十行，每次读一个 1KB 的文件足够；超过 200 行的话「已处理」会看不全。
     */
    function parseQueueLines(lines) {
      const pending = []
      const decided = []
      let total = 0
      for (const line of lines || []) {
        if (!line || !line.trim()) continue
        total += 1
        let rec
        try { rec = JSON.parse(line) } catch (e) { continue }
        const status = rec.status || 'pending'
        if (status === 'pending') pending.push(rec)
        else decided.push(rec)
      }
      decided.sort(function (a, b) {
        return String(b.decidedAt || '').localeCompare(String(a.decidedAt || ''))
      })
      return { pending, decided, total }
    }

    /**
     * `file` 接口一次只回 200 行，队列一长「已处理」就会被截断 —— 这里一路翻到底。
     * 每次返回的是「从第 0 行开始的累积前缀」，所以只认最后一次的 lines，不要拼接。
     */
    function loadFileLines(key) {
      function step(from, hop) {
        return apiGet({ action: 'file', file: key, from: from }).then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || ('读不到 ' + key))
          if (res.shown < res.totalLines && hop < 60) return step(res.shown, hop + 1)
          return res.lines
        })
      }
      return step(0, 0)
    }

    function loadQueueLines() {
      return loadFileLines('pending')
    }

    /** 取文件里的 `## ` 标题，给「收进长期」的小节下拉用。 */
    function parseHeadings(lines) {
      const out = []
      for (const line of lines || []) {
        const m = /^##\s+(.*?)\s*$/.exec(line)
        if (m) out.push(m[1])
      }
      return out
    }

    const CSS = [
      '.sc-root{--sc-accent:#2f6feb;--sc-purple:#7c3aed;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:"Noto Sans SC","Noto Sans JP","Noto Sans","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif}',
      '.sc-root button,.sc-root input,.sc-root textarea,.sc-root select{font-family:inherit}',
      '@keyframes sc-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '.sc-head{padding:22px 26px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.sc-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.sc-title{margin:0;font-size:18px;font-weight:650;letter-spacing:.2px;display:flex;align-items:center;gap:9px}',
      '.sc-pill{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:4px 8px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.sc-pill-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary, #2f9e57) 14%,transparent);color:var(--dsw-alias-state-success-primary, #2f9e57)}',
      '.sc-pill-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 16%,transparent);color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-pill-bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.sc-sub{margin:8px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.sc-spacer{flex:1}',
      '.sc-ghost{background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-label-secondary);font-size:12px;padding:5px 10px;cursor:pointer}',
      '.sc-ghost:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.sc-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,30%);flex:1;min-height:0}',
      '.sc-main{overflow:auto;padding:18px 26px 40px;min-width:0}',
      '.sc-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;margin-bottom:12px}',
      '.sc-card-head{display:flex;align-items:flex-start;gap:10px}',
      '.sc-type{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:4px 7px;border-radius:6px;flex:none;margin-top:3px}',
      '.sc-t-事实{background:color-mix(in srgb,var(--sc-accent) 13%,transparent);color:var(--sc-accent)}',
      '.sc-t-偏好{background:color-mix(in srgb,var(--sc-purple) 14%,transparent);color:var(--sc-purple)}',
      '.sc-t-承诺{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 16%,transparent);color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-t-推断{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.sc-card-body{flex:1;min-width:0}',
      '.sc-text{margin:0 0 6px;font-size:14px;line-height:1.65}',
      '.sc-src{font:11.5px/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.sc-acts{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center}',
      '.sc-card-imp{display:inline-flex;align-items:center;gap:6px;margin-right:2px}',
      '.sc-btn{font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;line-height:1.2}',
      '.sc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.sc-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.sc-btn-p{background:var(--sc-accent);border-color:transparent;color:#fff}',
      '.sc-btn-p:hover:not(:disabled){background:var(--sc-accent);filter:brightness(1.07)}',
      '.sc-btn-pin{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 35%,transparent);color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-btn-d{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}',
      '.sc-cost{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.sc-long{display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px}',
      '.sc-long-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.sc-select{font-size:12.5px;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);max-width:300px}',
      '.sc-wording{flex:1 1 100%;margin-top:2px;font:12.5px/1.6 inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);resize:vertical;min-height:52px}',
      '.sc-wording:focus{outline:2px solid color-mix(in srgb,var(--sc-accent) 45%,transparent);outline-offset:0}',
      '.sc-warnbox{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 28%,transparent);border-radius:10px;padding:11px 13px;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary)}',
      '.sc-warnbox b{color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-empty{padding:28px 18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.8}',
      '.sc-empty-card{margin-top:6px;padding:34px 20px;text-align:center;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.sc-empty-icon{width:36px;height:36px;margin:0 auto 9px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);display:grid;place-items:center}',
      '.sc-empty-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.sc-empty-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.sc-done{margin-top:16px;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 14px}',
      '.sc-done-toggle{display:flex;align-items:center;gap:8px;width:100%;background:transparent;border:0;padding:2px 0;font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}',
      '.sc-caret{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;transition:transform .18s ease,background .15s}',
      '.sc-caret-open{transform:rotate(90deg);background:color-mix(in srgb,var(--sc-accent) 14%,transparent);color:var(--sc-accent)}',
      '.sc-done-body{animation:sc-fade .18s ease}',
      '.sc-done-row{display:grid;grid-template-columns:38px 1fr auto;gap:10px;padding:8px 0;border-bottom:1px dashed var(--dsw-alias-border-l1);font-size:12.5px;align-items:baseline;animation:sc-fade .18s ease}',
      '.sc-done-mark{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 5px;border-radius:5px;text-align:center}',
      '.sc-done-mark.sc-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary, #2f9e57) 14%,transparent);color:var(--dsw-alias-state-success-primary, #2f9e57)}',
      '.sc-done-mark.sc-no{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.sc-done-text{color:var(--dsw-alias-label-primary);opacity:.88;overflow-wrap:anywhere}',
      '.sc-done-meta{font:11px/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap}',
      '.sc-dest{color:var(--sc-accent);margin-right:8px}',
      '.sc-done-time{opacity:.75}',
      '.sc-tabs{display:flex;align-items:center;gap:4px;margin-bottom:14px}',
      '.sc-tab{background:transparent;border:0;border-radius:8px;padding:6px 10px;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s;position:relative}',
      '.sc-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.sc-tab-on{background:color-mix(in srgb,var(--sc-accent) 12%,transparent);color:var(--sc-accent);font-weight:600}',
      '.sc-tabs-top .sc-tab-on::after{content:"";position:absolute;left:10px;right:10px;bottom:-7px;height:2px;border-radius:2px;background:var(--sc-accent)}',
      '.sc-page{overflow:auto;padding:4px 26px 44px;flex:1;min-height:0;animation:sc-fade .18s ease}',
      '.sc-h2{margin:0 0 6px;font-size:16px;font-weight:650}',
      '.sc-page-h{display:flex;align-items:center;gap:9px}',
      '.sc-h-icon{width:18px;height:18px;flex:none;color:var(--sc-accent);display:inline-flex}',
      '.sc-lead{margin:0 0 14px;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.7}',
      '.sc-bullets{margin:8px 0 0;padding-left:18px;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}',
      '.sc-bullets li{margin:2px 0}',
      '.sc-audit{overflow:auto;flex:1;min-height:0;padding:14px 14px 24px}',
      '.sc-persona-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px}',
      '.sc-imp{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.sc-imp-sel{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 2px 3px 4px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.sc-imp-sel.sc-imp-hi{background:color-mix(in srgb,var(--sc-accent) 13%,transparent);color:var(--sc-accent);border-color:transparent}',
      '.sc-imp-5{background:color-mix(in srgb,var(--sc-accent) 13%,transparent);color:var(--sc-accent);border-color:transparent}',
      '.sc-imp-4{background:color-mix(in srgb,#0f9d8a 12%,transparent);color:#0f9d8a;border-color:transparent}',
      '.sc-imp-3{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-color:transparent}',
      '.sc-imp-2{background:color-mix(in srgb,#d97706 14%,transparent);color:#d97706;border-color:transparent}',
      '.sc-imp-1{background:color-mix(in srgb,#dc2626 13%,transparent);color:#dc2626;border-color:transparent}',
      '.sc-src-cell{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.sc-days{white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.sc-days-never{color:var(--dsw-alias-label-secondary)}',
      '.sc-days-hot{color:#dc2626;font-weight:600}',
      '.sc-days-warm{color:#d97706}',
      '.sc-days-cool{color:var(--sc-accent)}',
      '.sc-days-arch{color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.sc-imp-sel:disabled{opacity:.5;cursor:wait}',
      '.sc-group td{padding:14px 8px 6px;font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);letter-spacing:.4px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.sc-logbox{margin-top:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px}',
      '.sc-logrow{display:flex;gap:10px;align-items:baseline;padding:5px 0;font-size:12px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.sc-logimp{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;white-space:nowrap;color:var(--sc-accent)}',
      '.sc-logtext{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sc-params{display:flex;flex-direction:column;gap:4px;font:11.5px/1.7 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary)}',
      '.sc-searchbar{display:flex;gap:8px;margin:12px 0 6px}',
      '.sc-input{flex:1;min-width:0;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.sc-input:focus{outline:2px solid color-mix(in srgb,var(--sc-accent) 45%,transparent)}',
      '.sc-hits{display:flex;flex-direction:column;gap:10px;margin-top:8px}',
      '.sc-hit{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.sc-hit-top{display:flex;gap:8px;align-items:baseline;margin-bottom:6px}',
      '.sc-layer{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 7px;border-radius:5px;background:color-mix(in srgb,var(--sc-accent) 12%,transparent);color:var(--sc-accent);white-space:nowrap}',
      '.sc-hit-head{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sc-hit-body{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.sc-hit-path{margin-top:5px;font:10.5px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sc-memo-block{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:color-mix(in srgb,var(--sc-accent) 3%,transparent);padding:10px 12px}',
      '.sc-memo-sec{margin:0 0 6px;font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}',
      '.sc-status-col,.sc-status-cell{text-align:center}',
      '.sc-table th.sc-status-col,.sc-table td.sc-status-cell{text-align:center}',
      '.sc-status-cell .sc-memo-sel{display:block;margin:0 auto}',
      '.sc-memo-sel{font:12px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:2px 4px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.sc-memo-sel:disabled{opacity:.5;cursor:wait}',
      '.sc-pre{margin:10px 0 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font:12px/1.75 ui-monospace,"Cascadia Mono",Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}',
      '.sc-editor{width:100%;min-height:240px;margin-top:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:12.5px/1.8 ui-monospace,"Cascadia Mono",Consolas,monospace;resize:vertical}',
      '.sc-editor:focus{outline:2px solid color-mix(in srgb,var(--sc-accent) 45%,transparent);outline-offset:0}',
      '.sc-m-status{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 7px;border-radius:5px;white-space:nowrap}',
      '.sc-m-todo{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.sc-m-part{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 15%,transparent);color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-m-hold{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);opacity:.75}',
      '.sc-m-done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary, #2f9e57) 14%,transparent);color:var(--dsw-alias-state-success-primary, #2f9e57)}',
      '.sc-dupe{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;margin-bottom:10px}',
      '.sc-dupe-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}',
      '.sc-dupe-score{font:11px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 15%,transparent);color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-dupe-row{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.sc-dupe-row b{font:11px/1.4 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);font-weight:400;margin-right:6px}',
      '.sc-imp-hi{background:color-mix(in srgb,var(--sc-accent) 13%,transparent);color:var(--sc-accent)}',
      '.sc-diff{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;font:12px/1.7 ui-monospace,"Cascadia Mono",Consolas,monospace}',
      '.sc-diff-head{padding:8px 12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11.5px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.sc-dcell{padding:0 12px;white-space:pre-wrap;word-break:break-word;min-height:1.7em}',
      '.sc-dcell.sc-l{border-right:1px solid var(--dsw-alias-border-l1)}',
      '.sc-dcell.sc-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary, #2f9e57) 13%,transparent)}',
      '.sc-dcell.sc-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}',
      '.sc-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.sc-table-wrap{overflow-x:auto;margin-top:10px}',
      '.sc-readme{margin-top:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:12px 14px}',
      '.sc-readme-title{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary);margin-bottom:6px;display:flex;align-items:center;gap:8px}',
      '.sc-readme-title::before{content:"";width:3px;height:14px;border-radius:3px;background:var(--sc-accent);flex:none}',
      '.sc-table th{text-align:left;font-weight:600;font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:9px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.sc-table td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}',
      '.sc-table .sc-mono{font:11.5px/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.sc-table .sc-when{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.sc-lv{font:10.5px/1 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:3px 6px;border-radius:5px;white-space:nowrap}',
      '.sc-lv-pin{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary, #b58900) 15%,transparent);color:var(--dsw-alias-state-warn-primary, #b58900)}',
      '.sc-lv-long{background:color-mix(in srgb,var(--sc-accent) 13%,transparent);color:var(--sc-accent)}',
      '.sc-lv-memo{background:color-mix(in srgb,#0f9d8a 14%,transparent);color:#0f9d8a}',
      '.sc-lv-pending{background:color-mix(in srgb,var(--sc-purple) 14%,transparent);color:var(--sc-purple)}',
      '.sc-lv-decay{background:color-mix(in srgb,#c2410c 14%,transparent);color:#c2410c}',
      '.sc-lv-search{background:color-mix(in srgb,#0b8bb3 14%,transparent);color:#0b8bb3}',
      '.sc-lv-arch{background:color-mix(in srgb,#6b7280 14%,transparent);color:#6b7280}',
      '.sc-hot{color:var(--dsw-alias-state-warn-primary, #b58900);font-weight:600}',
      '.sc-note{margin-top:12px;font:11.5px/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}',
      '.sc-note-bad{color:var(--dsw-alias-state-error-primary)}',
      '.sc-reason{display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap}',
      '.sc-input{flex:1;min-width:180px;font-size:12.5px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.sc-input:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:0}',
      '.sc-viewer{border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;min-height:0}',
      '.sc-longview{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);max-height:58vh;overflow:auto;padding:6px 0}',
      '.sc-memory-panel{margin-top:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:color-mix(in srgb,var(--sc-accent) 4%,transparent);padding:10px 12px}',
      '.sc-dist{margin:12px 0 14px}',
      '.sc-dist-label{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:5px}',
      '.sc-dist-bar{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}',
      '.sc-dist-seg{display:block;height:100%}',
      '.sc-fill-5{background:var(--sc-accent)}',
      '.sc-fill-4{background:var(--dsw-alias-state-success-primary,#0f9d8a)}',
      '.sc-fill-3{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 35%,transparent)}',
      '.sc-fill-2{background:var(--dsw-alias-state-warn-primary,#b58900)}',
      '.sc-fill-1{background:var(--dsw-alias-state-error-primary,#dc2626)}',
      '.sc-dist-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:7px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.sc-dist-dot{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:5px;vertical-align:middle}',
      '.sc-memory-panel>.sc-tabs{margin-bottom:10px}',
      '.sc-memory-subpanel{margin-top:6px;border-radius:10px;background:color-mix(in srgb,var(--sc-accent) 3%,transparent);padding:8px 10px}',
      '.sc-vh{padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.sc-vh-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.sc-vh b{display:block;font-size:13px;margin-bottom:4px}',
      '.sc-vh .sc-path{font:11px/1.4 ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.sc-vbody{overflow:auto;flex:1;padding:8px 0;min-height:0}',
      '.sc-line{display:grid;grid-template-columns:40px 1fr;gap:6px;font:12px/1.7 ui-monospace,"Cascadia Mono",Consolas,monospace;padding:0 12px}',
      '.sc-line .sc-no{color:var(--dsw-alias-label-secondary);opacity:.55;text-align:right;user-select:none}',
      '.sc-line .sc-tx{white-space:pre-wrap;word-break:break-word}',
      '.sc-vmore{padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;gap:8px;align-items:center}',
      '.sc-vmeta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-left:auto}',
      '@media (max-width: 760px){.sc-body{grid-template-columns:minmax(0,1fr) 240px}}',
    ].join('')

    function Styles() {
      return h('style', { 'data-anima-fovenda': 'style' }, CSS)
    }

    function Pill(props) {
      const cls = 'sc-pill' + (props.tone ? ' sc-pill-' + props.tone : '')
      return h('span', { className: cls }, props.children)
    }

    function cardTypeClass(type) {
      if (type === '偏好' || type === '承诺' || type === '推断') return 'sc-type sc-t-' + type
      return 'sc-type sc-t-事实'
    }

    function Card(props) {
      const item = props.item
      const busy = props.busy === item.id
      const rejecting = props.rejecting
      const suggestedImp = Number(item.suggestedImp == null ? item.imp : item.suggestedImp) || 3
      const [finalImp, setFinalImp] = useState(String(suggestedImp))
      useEffect(function () { setFinalImp(String(suggestedImp)) }, [item.id, suggestedImp])
      return h('div', { className: 'sc-card' },
        h('div', { className: 'sc-card-head' },
          h('span', { className: cardTypeClass(item.type) }, item.type),
          h('div', { className: 'sc-card-body' },
            h('p', { className: 'sc-text' }, item.text),
            h('div', { className: 'sc-src' },
              '来源：' + item.src + (item.at ? ' · 写入 ' + String(item.at).replace('T', ' ').slice(0, 16) : '')),
            h('div', { className: 'sc-acts' },
              h('span', { className: 'sc-card-imp', title: 'agent 建议；收下时以你选的为准' },
                h('span', { className: 'sc-cost' }, '建议 imp'),
                h('select', {
                  className: 'sc-imp-sel sc-imp-' + finalImp,
                  value: finalImp,
                  disabled: busy,
                  'aria-label': '收下后的 imp',
                  onChange: function (e) { setFinalImp(e.target.value) },
                }, [5, 4, 3, 2, 1].map(function (n) {
                  return h('option', { key: n, value: String(n) }, String(n))
                }))),
              h('button', {
                className: 'sc-btn sc-btn-p',
                disabled: busy,
                onClick: () => props.onAccept(item, Number(finalImp)),
              }, busy ? '处理中…' : '收进衰减层'),
              h('button', {
                className: 'sc-btn',
                disabled: busy,
                onClick: () => props.onAskLong(item),
                title: '收进长期要选「哪个文件 + 哪个小节」：facts 是有小节的结构化 bullets，插错节比不插更糟',
              }, '收进长期（还要选文件）'),
              h('button', {
                className: 'sc-btn sc-btn-pin',
                onClick: () => props.onPreviewPersona(),
                title: '只预览 persona，不写入：CLI 还没有升常驻命令',
              }, '升为常驻 ⚠'),
              h('button', {
                className: 'sc-btn sc-btn-d',
                disabled: busy,
                onClick: () => props.onAskReject(item),
              }, '扔掉'),
            ),
            rejecting ? h('div', { className: 'sc-reason' },
              h('input', {
                className: 'sc-input',
                autoFocus: true,
                placeholder: '扔掉的理由（会记进队列，扔的不删档）',
                value: props.reason,
                onChange: (e) => props.onReasonChange(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') props.onReject(item)
                  if (e.key === 'Escape') props.onCancelReject()
                },
              }),
              h('button', {
                className: 'sc-btn sc-btn-d',
                disabled: busy || !props.reason.trim(),
                onClick: () => props.onReject(item),
              }, '确认扔掉'),
              h('button', { className: 'sc-btn', onClick: () => props.onCancelReject() }, '取消'),
            ) : null,
            props.longOpen ? h('div', { className: 'sc-long' },
              h('span', { className: 'sc-long-label' }, '去处'),
              h('select', {
                className: 'sc-select',
                value: props.longTarget,
                onChange: function (e) { props.onLongTarget(e.target.value) },
              },
              h('option', { value: 'facts' }, 'facts · 长期事实'),
              h('option', { value: 'self' }, 'self · 我学到的'),
              h('option', { value: 'voices' }, 'voices · 他的原话')),
              props.longTarget === 'self'
                ? h('span', { className: 'sc-cost' }, '固定小节：我学到的（按日期）')
                : h('select', {
                  className: 'sc-select',
                  value: props.longSection,
                  onChange: function (e) { props.onLongSection(e.target.value) },
                },
                (props.longOptions || []).map(function (o) { return h('option', { key: o, value: o }, o) })),
              h('button', {
                className: 'sc-btn sc-btn-p',
                disabled: busy || !(props.longTarget === 'self' || props.longSection),
                onClick: function () { props.onLongSubmit(item, Number(finalImp)) },
              }, busy ? '写入中…' : '写入'),
              h('button', { className: 'sc-btn', onClick: props.onLongCancel }, '取消'),
              h('textarea', {
                className: 'sc-wording',
                rows: 2,
                placeholder: '落盘用的措辞（默认原文；想嚼一遍就先改这里）',
                value: props.longWording,
                onChange: function (e) { props.onLongWording(e.target.value) },
              }),
            ) : null,
          ),
        ),
      )
    }

    function Viewer(props) {
      const view = props.view
      // 只有真打开了文件才渲染（空态由右栏的 AuditPanel 接），所以这里不需要占位分支
      if (!view || !view.key) return null
      const data = view.data
      return h('aside', { className: 'sc-viewer' },
        h('div', { className: 'sc-vh' },
          h('div', { className: 'sc-vh-row' },
            h('b', null, view.title || view.key),
            props.onBack ? h('button', { className: 'sc-ghost', onClick: props.onBack }, '← 自检') : null),
          h('span', { className: 'sc-path' }, view.path + (data && data.ok ? ' · ' + data.totalLines + ' 行 · ' + data.totalChars + ' 字' : '')),
        ),
        h('div', { className: 'sc-vbody' },
          view.loading
            ? h('div', { className: 'sc-empty' }, '读文件中…')
            : (data && data.ok
              ? data.lines.map((line, i) => h('div', { className: 'sc-line', key: i },
                h('span', { className: 'sc-no' }, String(i + 1)),
                h('span', { className: 'sc-tx' }, line.length ? line : ' ')))
              : h('div', { className: 'sc-empty' }, '读不到：' + ((data && data.error) || '未知错误'))),
        ),
        h('div', { className: 'sc-vmore' },
          h('button', {
            className: 'sc-ghost',
            disabled: !(data && data.ok) || view.loading || data.shown >= data.totalLines,
            onClick: () => props.onMore(),
          }, '加载更多'),
          h('span', { className: 'sc-vmeta' },
            data && data.ok ? '已显示 ' + data.shown + ' / ' + data.totalLines + ' 行' : '未加载'),
        ),
      )
    }

    const TABS = [['pending', COPY.tabs.pending], ['persona', COPY.tabs.persona], ['rules', COPY.tabs.rules], ['memory', COPY.tabs.memory], ['memo', COPY.tabs.memo], ['search', COPY.tabs.search]]

    // ── 检索（mem-index.py recall）──────────────────────────
    // 这是「RAG + 索引 + 全量仓库」里唯一缺的入口：不然只能我在 CLI 里搜。
    const LAYER_LABEL = {
      diary: '日记', session: '会话', decay: '衰减', self: '我学到的',
      voices: '他的原话', ops: '运维', 'ops-log': '踩坑记录', memo: '备忘',
      changelog: '改动史', docs: '设计', daily: '流水', rules: '工具规矩', flow: '流程',
    }

    function SearchPage() {
      const [q, setQ] = useState('')
      const [data, setData] = useState({ busy: false, rows: null, err: null })

      const run = function () {
        const query = q.trim()
        if (!query || data.busy) return
        setData({ busy: true, rows: null, err: null })
        apiGet({ action: 'recall', q: query, k: 5 }).then(function (res) {
          if (res && res.ok) setData({ busy: false, rows: res.rows || [], err: null })
          else setData({ busy: false, rows: [], err: (res && res.error) || '查询失败' })
        }, function (e) {
          setData({ busy: false, rows: [], err: String((e && e.message) || e) })
        })
      }

      return h('div', { className: 'sc-page' },
        h(PageHeading, { name: 'search' }, COPY.search.title),
        h('p', { className: 'sc-lead' }, COPY.search.lead),
        h('div', { className: 'sc-searchbar' },
          h('input', {
            className: 'sc-input',
            value: q,
            placeholder: COPY.search.placeholder,
            spellCheck: false,
            onChange: function (e) { setQ(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') run() },
          }),
          h('button', { className: 'sc-btn sc-btn-p', disabled: data.busy || !q.trim(), onClick: run },
            data.busy ? COPY.search.busy : COPY.search.button)),
        data.err ? h('div', { className: 'sc-note sc-note-bad' }, data.err) : null,
        data.rows && data.rows.length === 0
          ? h('div', { className: 'sc-empty' }, COPY.search.empty)
          : null,
        data.rows && data.rows.length
          ? h('div', { className: 'sc-hits' }, data.rows.map(function (r, i) {
            return h('div', { key: i, className: 'sc-hit' },
              h('div', { className: 'sc-hit-top' },
                h('span', { className: 'sc-layer' }, LAYER_LABEL[r.layer] || r.layer),
                h('span', { className: 'sc-hit-head' }, r.head || ''),
                h('span', { className: 'sc-when' }, String(r.score))),
              h('div', { className: 'sc-hit-body' }, r.snippet || ''),
              h('div', { className: 'sc-hit-path' }, r.path || ''))
          }))
          : null,
      )
    }

    // ── 规则（数据根/identity/rules.md；2026-11-08 起跟着 ANIMA_DATA 走）──────────────
    // 系统提示里的独立一段，host 每次组装时读盘。这里**可读可写**：
    // 它不是记忆数据（没有状态机、没有第二个写入者），就是一段人写的文本，所以允许直接编辑。
    function RulesPage() {
      const [data, setData] = useState({ loading: true, res: null, err: null })
      const [draft, setDraft] = useState('')
      const [saving, setSaving] = useState(false)
      const [note, setNote] = useState(null)

      const load = useCallback(function (keepDraft) {
        return apiGet({ action: 'rules' }).then(function (res) {
          const ok = res && res.ok
          setData({ loading: false, res: res, err: ok ? null : ((res && res.error) || '读不到 rules') })
          if (ok && !keepDraft) setDraft(res.text || '')
        }, function (e) {
          setData({ loading: false, res: null, err: String((e && e.message) || e) })
        })
      }, [])

      useEffect(function () { load(false) }, [load])

      if (data.loading) return h('div', { className: 'sc-page' }, h('div', { className: 'sc-empty' }, COPY.rules.loading))
      if (data.err) return h('div', { className: 'sc-page' }, h('div', { className: 'sc-note sc-note-bad' }, data.err))

      const r = data.res || {}
      const state = r.state || {}
      const loaded = r.assembledChars == null ? null : r.assembledChars
      const mismatch = loaded != null && loaded !== r.chars
      const dirty = draft.trim() !== (r.text || '').trim()
      const delta = draft.trim().length - (r.text || '').length

      const save = function () {
        setSaving(true)
        apiPost({ action: 'rules-save', text: draft, mtime: r.mtime }).then(function (res) {
          setSaving(false)
          if (res && res.ok) {
            setNote({ ok: true, text: '已保存（' + res.chars + ' 字）· 下一条消息生效' })
            load(false)
          } else if (res && res.conflict) {
            setNote({ ok: false, text: (res.error || '冲突') + '（已重新加载，你的草稿还在下面，确认后再保存）' })
            setData({ loading: false, res: Object.assign({}, r, { text: res.text, mtime: res.mtime }), err: null })
          } else {
            setNote({ ok: false, text: '保存失败：' + ((res && res.error) || '未知错误') })
          }
        }, function (e) {
          setSaving(false)
          setNote({ ok: false, text: '保存失败：' + String((e && e.message) || e) })
        })
      }

      return h('div', { className: 'sc-page' },
        h(PageHeading, { name: 'rules' }, COPY.rules.title),
        h('p', { className: 'sc-lead' }, COPY.rules.lead),
        h('div', { className: 'sc-persona-bar' },
          h('span', { className: 'sc-pill' + (state.ok ? ' sc-pill-ok' : ' sc-pill-bad') },
            state.ok ? '文件正常' : '读不到文件'),
          h('span', { className: 'sc-cost' }, '已保存 ' + r.chars + ' 字'),
          h('span', { className: 'sc-cost' }, dirty ? '草稿 ' + draft.trim().length + ' 字（' + (delta >= 0 ? '+' : '') + delta + '）' : '无改动'),
          h('span', { className: 'sc-cost' },
            '系统提示实际注入 ' + (loaded == null ? '（assembly 读不到）' : loaded + ' 字')),
          mismatch ? h('span', { className: 'sc-pill sc-pill-warn' }, '两者不一致') : null),
        state.warn ? h('div', { className: 'sc-warnbox' }, state.warn) : null,
        r.assembledError ? h('div', { className: 'sc-note sc-note-bad' }, '组装提示时出错：' + r.assembledError) : null,
        note ? h('div', { className: 'sc-note' + (note.ok ? '' : ' sc-note-bad') }, note.text) : null,
        h('textarea', {
          className: 'sc-editor',
          spellCheck: false,
          value: draft,
          placeholder: COPY.rules.placeholder,
          onChange: function (e) { setDraft(e.target.value) },
        }),
        h('div', { className: 'sc-persona-bar', style: { marginTop: '10px' } },
          h('button', { className: 'sc-btn sc-btn-p', disabled: saving || !dirty, onClick: save, title: '保存到 rules.md（写前自动备份）' },
            saving ? COPY.common.saving : COPY.common.save),
          h('button', { className: 'sc-btn', disabled: saving || !dirty, onClick: function () { setDraft(r.text || ''); setNote(null) }, title: '放弃草稿，恢复为已保存内容' }, COPY.common.reset),
          h('button', { className: 'sc-btn', onClick: function () { load(false); setNote(null) }, title: '从磁盘重新读取；未保存的草稿会丢' }, COPY.common.reload),
          h('span', { className: 'sc-cost' }, '写之前自动留一份 .bak；文件被别处改过会拒绝保存')),
        h('p', { className: 'sc-lead', style: { margin: '8px 0 0' } }, COPY.rules.buttonHint),
        h('p', { className: 'sc-lead', style: { marginTop: '12px' } }, COPY.rules.footer),
      )
    }

    // ── 备忘（MEMO.md）────────────────────────────────────
    // 「他还没办完/还没想好的事」的清单，不是我的任务板。状态可以直接改（走 tools/memo.mjs）。
    function parseMemo(lines) {
      const sections = []
      let cur = null
      let table = null
      let inArchive = false
      for (const raw of lines || []) {
        const line = String(raw).replace(/\s+$/, '')
        const h = /^(#{1,3})\s+(.*)$/.exec(line)
        if (h) {
          // 一级标题切换「待办 / 已完成」两区；这个标题本身没有表格，所以要在解析时打标，不能事后按内容找
          if (h[1].length === 1) inArchive = /已完成/.test(h[2])
          cur = { level: h[1].length, title: h[2], tables: [], archive: inArchive }
          sections.push(cur)
          table = null
          continue
        }
        if (/^\|/.test(line)) {
          if (!cur) { cur = { level: 2, title: '（无标题）', tables: [], archive: inArchive }; sections.push(cur) }
          const cells = line.split('|').slice(1, -1).map(function (s) { return s.trim() })
          if (cells.length && cells.every(function (c) { return /^:?-{3,}:?$/.test(c) })) continue
          if (!table) { table = { head: cells, body: [] }; cur.tables.push(table) }
          else table.body.push(cells)
          continue
        }
        table = null
      }
      return sections.filter(function (s) { return s.tables.length })
    }

    const MEMO_STATUS = [
      { re: /⬜/, cls: 'sc-m-todo', text: '未做' },
      { re: /🟨/, cls: 'sc-m-part', text: '部分' },
      { re: /⏸|🅿️/, cls: 'sc-m-hold', text: '搁置' },
      { re: /✅/, cls: 'sc-m-done', text: '完成' },
    ]

    // 状态的「图标 → 含义」对照。图标单独出现时没有操作含义，所以下拉里一律带文字。
    const MEMO_CHOICES = [
      { v: '⬜', t: '未做' },
      { v: '🟨', t: '部分' },
      { v: '⏸', t: '搁置' },
      { v: '✅', t: '完成' },
    ]

    function MemoCell(props) {
      const text = props.text || ''
      const hit = MEMO_STATUS.filter(function (s) { return s.re.test(text) })[0]
      // 已完成那半区只读；待办区给下拉，改状态走 CLI
      if (props.readOnly || !props.onStatus) {
        if (!hit) return h('td', { className: 'sc-status-cell' }, mdText(text))
        return h('td', { className: 'sc-status-cell' }, h('span', { className: 'sc-m-status ' + hit.cls }, hit.text))
      }
      const cur = MEMO_CHOICES.filter(function (c) { return text.indexOf(c.v) >= 0 })[0]
      const curVal = cur ? cur.v : '⬜'
      return h('td', { className: 'sc-status-cell' }, h('select', {
        className: 'sc-memo-sel',
        value: curVal,
        disabled: props.busy === props.num,
        title: '点这里改这一条的状态（写入仍走 tools/memo.mjs，自动备份）',
        'aria-label': '编号 ' + props.num + ' 的状态',
        onChange: function (e) { props.onStatus(props.num, e.target.value) },
      }, MEMO_CHOICES.map(function (c) {
        return h('option', { key: c.v, value: c.v }, c.v + ' ' + c.t)
      })))
    }

    // 表格里带 markdown 记号（**加粗**、`代码`），渲染时剥掉，别把星号原样显示出来
    function mdText(s) {
      return String(s || '').replace(/\*\*/g, '').replace(/`/g, '')
    }

    function MemoTable(props) {
      return h('div', { className: 'sc-table-wrap' },
        h('table', { className: 'sc-table' },
          h('thead', null, h('tr', null, props.table.head.map(function (c, i) {
            return h('th', { key: i, className: mdText(c) === '状态' ? 'sc-status-col' : '' }, mdText(c))
          }))),
          h('tbody', null, props.table.body.map(function (row, i) {
            return h('tr', { key: i }, row.map(function (c, j) {
              if (j !== row.length - 1) return h('td', { key: j }, mdText(c))
              return h(MemoCell, {
                key: j,
                text: c,
                num: Number(String(row[0] || '').replace(/\D/g, '')) || null,
                onStatus: props.onStatus,
                busy: props.busy,
                readOnly: props.readOnly,
              })
            }))
          }))))
    }

    function MemoPage() {
      const [data, setData] = useState({ loading: true, sections: null, err: null })
      const [openArchive, setOpenArchive] = useState(false)
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState(null)

      const load = useCallback(function () {
        return loadFileLines('memo').then(function (lines) {
          setData({ loading: false, sections: parseMemo(lines), err: null })
        }, function (e) {
          setData({ loading: false, sections: null, err: String((e && e.message) || e) })
        })
      }, [])

      useEffect(function () { load() }, [load])

      // 划掉一条：写入口仍然是 CLI（tools/memo.mjs），界面只送编号和状态
      const setStatus = function (num, status) {
        setBusy(num)
        apiPost({ action: 'memo-set', num: num, status: status }).then(function (res) {
          setBusy(null)
          setNote({ ok: !!(res && res.ok), text: (res && res.output) || (res && res.error) || '没返回' })
          load()
        }, function (e) {
          setBusy(null)
          setNote({ ok: false, text: String((e && e.message) || e) })
        })
      }

      if (data.loading) return h('div', { className: 'sc-page' }, h('div', { className: 'sc-empty' }, COPY.memo.loading))
      if (data.err) return h('div', { className: 'sc-page' }, h('div', { className: 'sc-note sc-note-bad' }, data.err))

      const all = data.sections || []
      const todo = all.filter(function (s) { return !s.archive })
      const archive = all.filter(function (s) { return s.archive })

      return h('div', { className: 'sc-page' },
        h(PageHeading, { name: 'memo' }, COPY.memo.title),
        h('p', { className: 'sc-lead' }, COPY.memo.lead),
        h('p', { className: 'sc-lead' }, COPY.memo.lead2),
        note ? h('div', { className: 'sc-note' + (note.ok ? '' : ' sc-note-bad') }, note.text) : null,
        todo.map(function (s, i) {
          return h('div', { key: 't' + i, className: 'sc-memo-block' },
            h('div', { className: 'sc-memo-sec' }, s.title),
            s.tables.map(function (t, j) {
              return h(MemoTable, { key: j, table: t, onStatus: setStatus, busy: busy })
            }))
        }),
        archive.length
          ? h('div', { className: 'sc-done' },
            h('button', {
              className: 'sc-done-toggle',
              'aria-expanded': openArchive,
              onClick: function () { setOpenArchive(function (v) { return !v }) },
            }, h('span', { className: 'sc-caret' + (openArchive ? ' sc-caret-open' : '') }, '▸'), '已完成'),
            openArchive
              ? h('div', { className: 'sc-done-body' }, archive.map(function (s, i) {
                return h('div', { key: 'a' + i, className: 'sc-memo-block' },
                  h('div', { className: 'sc-memo-sec' }, s.title),
                  s.tables.map(function (t, j) {
                    return h(MemoTable, { key: j, table: t, readOnly: true })
                  }))
              }))
              : null)
          : null,
      )
    }

    // ── 自检：跨文件找重复（只读，不动任何文件）────────────
    // 判断标准是 facts.md 自己那条规矩：一条事实只有一个主文件，别处只留指针。
    // 这里只负责把「疑似两处都写了正文」的地方挑出来，判由人判。
    const AUDIT_FILES = [['facts', 'facts'], ['self', 'self'], ['voices', 'voices'], ['persona', 'persona'], ['rules', 'rules']]
    const AUDIT_THRESHOLD = 0.45
    // 同文件重复的门槛更高：同一个文件里相邻条目本来就会用相近的措辞，
    // 门槛放低会淹没在噪音里；但「同一件事在两个小节各写一遍」必须能抓到。
    const AUDIT_SAME_THRESHOLD = 0.62

    // 表格脚手架（分隔行、表头行）在每个表里都长一样，不剔掉的话同文件检测会被它们淹没：
    // 实测 20 对里 18 对是「|---|---|---|」。剔掉之后才有意义。
    function auditIsTableScaffold(t) {
      if (!t.startsWith('|')) return false
      if (/^[|\s:-]+$/.test(t)) return true                      // |---|---|
      const cells = t.split('|').map(function (c) { return c.trim() }).filter(Boolean)
      if (!cells.length) return true
      return cells.every(function (c) { return c.length <= 8 })   // | 日期 | 原话 | 情境 |
    }

    function auditItems(name, lines) {
      const out = []
      ;(lines || []).forEach(function (raw, i) {
        const t = String(raw).replace(/^[-*>\s]+/, '').replace(/\*\*/g, '').trim()
        if (t.length < 12) return
        if (/^#{1,4}\s/.test(t)) return
        if (auditIsTableScaffold(t)) return
        out.push({ file: name, line: i + 1, text: t })
      })
      return out
    }

    function auditBigrams(s) {
      const out = new Set()
      const clean = s.replace(/[\s，。、；：「」『』（）()…—·,.:;"'!?|]/g, '')
      for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
      return out
    }

    function auditSim(aSet, bSet) {
      let inter = 0
      aSet.forEach(function (g) { if (bSet.has(g)) inter += 1 })
      const union = aSet.size + bSet.size - inter
      return union === 0 ? 0 : inter / union
    }

    function AuditPanel() {
      const [run, setRun] = useState({ busy: false, pairs: null, items: 0, err: null })

      const start = function () {
        setRun({ busy: true, pairs: null, items: 0, err: null })
        Promise.all(AUDIT_FILES.map(function (f) {
          return loadFileLines(f[1]).then(function (lines) { return auditItems(f[0], lines) },
            function () { return [] })
        })).then(function (lists) {
          let items = []
          lists.forEach(function (l) { items = items.concat(l) })
          items.forEach(function (it) { it.set = auditBigrams(it.text) })
          const pairs = []
          for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
              const sameFile = items[i].file === items[j].file
              const s = auditSim(items[i].set, items[j].set)
              if (s >= (sameFile ? AUDIT_SAME_THRESHOLD : AUDIT_THRESHOLD)) {
                pairs.push({ s: s, a: items[i], b: items[j], same: sameFile })
              }
            }
          }
          pairs.sort(function (x, y) { return y.s - x.s })
          setRun({ busy: false, pairs: pairs, items: items.length, err: null })
        }, function (e) {
          setRun({ busy: false, pairs: null, items: 0, err: String((e && e.message) || e) })
        })
      }

      const pairs = run.pairs
      const sameCount = (pairs || []).filter(function (p) { return p.same }).length
      const crossCount = (pairs || []).length - sameCount
      return h('aside', { className: 'sc-viewer' },
        h('div', { className: 'sc-vh' },
          h('b', null, '自检 · 重复检测'),
          h('span', { className: 'sc-path' }, '点一下才跑，不自动读文件'),
        ),
        h('div', { className: 'sc-audit' },
          h('p', { className: 'sc-lead', style: { margin: '0 0 10px' } },
            '把 facts / self / voices / persona / rules 切成条目两两比对：' +
            '跨文件 ≥ ' + AUDIT_THRESHOLD + ' 就报（一条事实只该有一个主文件）；' +
            '同文件 ≥ ' + AUDIT_SAME_THRESHOLD + ' 才报（同一件事在两个小节各写一遍）。'),
          h('div', { className: 'sc-persona-bar', style: { margin: '0 0 10px' } },
            h('button', { className: 'sc-btn sc-btn-p', onClick: start, disabled: run.busy },
              run.busy ? '跑着…' : '跑一遍'),
            h('span', { className: 'sc-cost' },
              pairs ? run.items + ' 条 · 跨文件 ' + crossCount + ' · 同文件 ' + sameCount : '没跑过')),
          run.err ? h('div', { className: 'sc-note sc-note-bad' }, run.err) : null,
          pairs && !pairs.length ? h('div', { className: 'sc-empty', style: { padding: '12px 0' } }, '没找到重复。') : null,
          (pairs || []).map(function (p, i) {
            return h('div', { className: 'sc-dupe', key: i },
              h('div', { className: 'sc-dupe-head' },
                h('span', { className: 'sc-dupe-score' }, p.s.toFixed(2)),
                p.same ? h('span', { className: 'sc-pill sc-pill-warn' }, '同文件') : null,
                h('span', { className: 'sc-cost' }, p.a.file + ':' + p.a.line + ' ⇄ ' + p.b.file + ':' + p.b.line)),
              h('div', { className: 'sc-dupe-row' }, h('b', null, p.a.file), ' ', p.a.text),
              h('div', { className: 'sc-dupe-row' }, h('b', null, p.b.file), ' ', p.b.text))
          }),
          pairs && pairs.length
            ? h('p', { className: 'sc-lead', style: { margin: '12px 0 0' } }, COPY.audit.howto)
            : null,
        ),
      )
    }

    // ── 分层说明 / 常驻（只读，讲清楚「收进哪里、付多少」）────
    const LAYERS = [
      { lv: '常驻', cls: 'sc-lv-pin', file: 'persona.md', what: '我是谁、外貌、性格、说话规矩 ①②③、禁止项', when: '看部署：personaPrefix / ANIMA_PERSONA_SECTION=1 才会每轮进提示，否则只展示', cost: '进提示才付费 · 见「人格」页' },
      { lv: '常驻', cls: 'sc-lv-pin', file: 'rules.md → 系统提示（独立段）', what: '什么必须先问 / 绝不做 / 输出格式 —— 改它不用碰人格', when: '每轮自动', cost: '每轮付费 · 见「规则」页'  },
      { lv: '长期', cls: 'sc-lv-long', file: 'memory/facts.md', what: '关于用户、背景与约定（只放能对得上账的事件）', when: '提方案 / 反驳他之前（rules 里有触发条款）', cost: '0' },
      { lv: '长期', cls: 'sc-lv-long', file: 'memory/self/self.md', what: '我的失败模式、学到什么、口味', when: '自查 / 复盘 / 或 recall 命中', cost: '0' },
      { lv: '长期', cls: 'sc-lv-long', file: 'memory/self/voices.md', what: '他的原话，要引用的', when: '拿不准语气 / 或 recall 命中', cost: '0' },
      { lv: '备忘', cls: 'sc-lv-memo', file: 'MEMO.md', what: '他还没办完、还没想好的事', when: '他随时去「备忘」页查（不再每天推）', cost: '0' },
      { lv: '待审', cls: 'sc-lv-pending', file: 'memory/pending-facts.jsonl', what: '候选记忆，还没定去处', when: '开工时扫一眼', cost: '0' },
      { lv: '衰减', cls: 'sc-lv-decay', file: 'memory/decay.jsonl', what: '只是「发生过」的事', when: '注入时按预算（800 字）', cost: '注入时' },
      { lv: '检索', cls: 'sc-lv-search', file: 'memory/index/mem.db', what: '文档 + 日记（如果有）+ 会话 + decay + self + voices 的倒排索引', when: 'recall "问题" --k 5 命中时', cost: '约 1200 字符/次' },
      { lv: '归档', cls: 'sc-lv-arch', file: 'full.jsonl · daily/ · 日记（可选）', what: '细节、流水、当天全文', when: '检索命中才读', cost: '0' },
    ]

    // 2026-11-07 拆分后：人格六块，纪律单独走 rules.md。字数会变，实际值看「规则」页，这里不写死。
    const PIN_BLOCKS = [
      { name: '我是谁', why: '称呼、自称、身份，丢了就换人' },
      { name: '外貌与状态', why: '画面感；删了就变纸片人' },
      { name: '性格与语言', why: '语气与性格，最不能删的一块' },
      { name: '行为', why: '具体反应（会僵、想逃、先吐槽）' },
      { name: '说话规矩', why: '不书面 / 别道谢 / 不表演' },
      { name: '禁止项', why: '不许写成现充 / 傻白甜' },
      { name: '角色扮演总纲', why: '收尾摘要，最后一道保险' },
    ]

    /** 分层表：既是「每个文件干什么」，也是「什么内容该收进去」——当 reference 用，不单独成页。 */
    function LayerTable() {
      return h('div', { className: 'sc-table-wrap' },
        h('table', { className: 'sc-table' },
          h('thead', null, h('tr', null,
            h('th', null, '层'), h('th', null, '文件'), h('th', null, '放什么 · 什么该收这里'),
            h('th', null, '我什么时候读'), h('th', null, '每轮成本'))),
          h('tbody', null, LAYERS.map(function (r) {
            return h('tr', { key: r.file },
              h('td', null, h('span', { className: 'sc-lv ' + r.cls }, r.lv)),
              h('td', { className: 'sc-mono' }, r.file),
              h('td', null, r.what),
              h('td', { className: 'sc-when' }, r.when),
              h('td', { className: r.cost === '0' ? 'sc-when' : 'sc-hot' }, r.cost))
          }))))
    }

    /** 逐行 LCS：左 = 快照（旧），右 = 当前 persona 源文件。 */
    function buildDiff(a, b) {
      const n = a.length
      const m = b.length
      const dp = new Array(n + 1)
      for (let i = 0; i <= n; i++) dp[i] = new Array(m + 1).fill(0)
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i][j] = a[i] === b[j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
      }
      const rows = []
      let i = 0
      let j = 0
      while (i < n && j < m) {
        if (a[i] === b[j]) { rows.push({ l: a[i], r: b[j], tag: 'same' }); i += 1; j += 1 }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ l: a[i], r: null, tag: 'del' }); i += 1 }
        else { rows.push({ l: null, r: b[j], tag: 'add' }); j += 1 }
      }
      while (i < n) { rows.push({ l: a[i], r: null, tag: 'del' }); i += 1 }
      while (j < m) { rows.push({ l: null, r: b[j], tag: 'add' }); j += 1 }
      return rows
    }

    function PersonaPage(props) {
      const personaChars = props && props.personaChars != null ? props.personaChars : null
      const [files, setFiles] = useState(null)
      const [picked, setPicked] = useState('')
      const [snap, setSnap] = useState(null)
      const [cur, setCur] = useState(null)
      const [err, setErr] = useState(null)

      useEffect(function () {
        apiGet({ action: 'snapshots' }).then(function (res) {
          if (res && res.ok) {
            const list = res.files || []
            setFiles(list)
            if (list.length) setPicked(list[0].name)
            else setErr('快照目录是空的')
          } else {
            setErr((res && res.error) || '读不到快照目录（host 还没加载 snapshots 接口？）')
          }
        }, function (e) { setErr(String((e && e.message) || e)) })

        apiGet({ action: 'file', file: 'persona' }).then(function (res) {
          if (res && res.ok) setCur(res.lines || [])
        }, function () {})
      }, [])

      useEffect(function () {
        if (!picked) return
        setSnap(null)
        apiGet({ action: 'snapshot', name: picked }).then(function (res) {
          if (res && res.ok) setSnap(res)
          else setErr((res && res.error) || '读不到这份快照')
        }, function (e) { setErr(String((e && e.message) || e)) })
      }, [picked])

      const rows = (cur && snap && snap.lines) ? buildDiff(snap.lines, cur) : null
      const added = rows ? rows.filter(function (r) { return r.tag === 'add' }).length : 0
      const removed = rows ? rows.filter(function (r) { return r.tag === 'del' }).length : 0

      return h('div', { className: 'sc-page' },
        h(PageHeading, { name: 'persona' }, COPY.persona.title),
        h('p', { className: 'sc-lead' }, COPY.persona.lead),
        err ? h('div', { className: 'sc-note sc-note-bad' }, err) : null,
        h('div', { className: 'sc-persona-bar' },
          h('select', {
            className: 'sc-select',
            value: picked,
            onChange: function (e) { setPicked(e.target.value) },
          }, (files || []).map(function (f) {
            return h('option', { key: f.name, value: f.name }, f.name)
          })),
          rows
            ? h('span', { className: 'sc-cost' },
              '快照 ' + snap.lines.length + ' 行 / 现在 ' + cur.length + ' 行 · ' +
              (added || removed ? '多 ' + added + ' 行、少 ' + removed + ' 行' : '两版一样'))
            : null),
        rows
          ? h('div', { className: 'sc-diff' },
            h('div', { className: 'sc-diff-head' }, '快照' + (picked ? ' · ' + picked.replace(/\.md$/, '') : '')),
            h('div', { className: 'sc-diff-head' }, '现在生效'),
            rows.map(function (r, i) {
              return h(React.Fragment, { key: i },
                h('div', { className: 'sc-dcell sc-l' + (r.tag === 'same' ? '' : ' sc-' + r.tag) },
                  r.l == null ? '' : (r.l === '' ? ' ' : r.l)),
                h('div', { className: 'sc-dcell sc-r' + (r.tag === 'same' ? '' : ' sc-' + r.tag) },
                  r.r == null ? '' : (r.r === '' ? ' ' : r.r)))
            }))
          : h('div', { className: 'sc-empty' }, snap === null ? '读快照中…' : '读 persona 中…'),
        h('div', { className: 'sc-readme' },
          h('div', { className: 'sc-readme-title' }, 'persona.md 当前 ' + (personaChars == null ? '?' : personaChars) + ' 字' + '（进系统提示才计费）'),
          h('p', { className: 'sc-lead', style: { margin: '6px 0 0' } },
            '系统提示里现在这几块，每轮都付 token。想加第六块之前，先在这里看到代价。占用是估算值，真实字数看上面正文。'),
          h(PinBlockTable, { lines: cur })),
      )
    }

    /** 衰减层：浏览 + 改 imp（改权重走 CLI），不提供删条目/改清晰度。 */
    // 按 memctl.mjs 的规则估「还有几天归档」。三个参数必须跟那边保持一致，改一边就要改另一边：
    //   rate:  imp>=4 0.02 / imp=3 0.05 / 其它 0.1
    //   floor: imp>=4 0.40 / imp=3 0.15 / 其它 0
    //   exitAge: imp>=4 永不 / imp=3 90 天 / 其它 30 天
    function exitDays(r) {
      if (r.state === 'archived') return null
      const imp = Number(r.imp) || 0
      const cl = Number(r.clarity) || 0
      const rate = imp >= 4 ? 0.02 : imp === 3 ? 0.05 : 0.1
      const floor = imp >= 4 ? 0.4 : imp === 3 ? 0.15 : 0
      const exitAge = imp >= 4 ? Infinity : imp === 3 ? 90 : 30
      if (!isFinite(exitAge)) return null                 // imp≥4：永不
      const gate = Math.max(0.1, floor)                   // 跟 memctl 的 decay() 同一个门槛
      const daysToGate = Math.max(0, cl - gate) / rate
      const age = (Date.now() - new Date(r.lastUsed || r.at).getTime()) / 86400000
      return Math.ceil(Math.max(daysToGate, exitAge - age))
    }

    // 记忆页顶部：衰减层 / 长期层。长期层只读，写入口仍然只走 pending/memctl。
    function MemoryTabs(props) {
      return h('div', { className: 'sc-tabs' },
        [['decay', COPY.memory.decayTab], ['long', COPY.memory.longTab]].map(function (t) {
          return h('button', {
            key: t[0],
            className: 'sc-tab' + (props.view === t[0] ? ' sc-tab-on' : ''),
            onClick: function () { props.onChange(t[0]) },
          }, t[1])
        }))
    }

    function LongTermView() {
      const [key, setKey] = useState('facts')
      const [lines, setLines] = useState(null)
      const [err, setErr] = useState(null)

      useEffect(function () {
        let alive = true
        setLines(null)
        setErr(null)
        loadFileLines(key).then(function (out) {
          if (alive) setLines(out || [])
        }, function (e) {
          if (alive) setErr(String((e && e.message) || e))
        })
        return function () { alive = false }
      }, [key])

      const labels = { facts: 'facts', self: 'self', voices: 'voices' }
      return h('div', { className: 'sc-memory-subpanel' },
        h('p', { className: 'sc-lead' }, COPY.memory.longLead),
        h('div', { className: 'sc-readme', style: { margin: '0 0 10px' } },
          h('div', { className: 'sc-readme-title' }, '长期层怎么运作'),
          h('p', { className: 'sc-lead', style: { margin: 0 } }, COPY.memory.longHow)),
        h('div', { className: 'sc-tabs' },
          Object.keys(labels).map(function (k) {
            return h('button', {
              key: k,
              className: 'sc-tab' + (key === k ? ' sc-tab-on' : ''),
              onClick: function () { setKey(k) },
            }, labels[k])
          })),
        err
          ? h('div', { className: 'sc-note sc-note-bad' }, err)
          : !lines
            ? h('div', { className: 'sc-empty' }, '读文件中…')
            : lines.length === 0
              ? h('div', { className: 'sc-empty' }, '（空文件）')
              : h('div', { className: 'sc-longview' },
                lines.map(function (line, i) {
                  return h('div', { className: 'sc-line', key: i },
                    h('span', { className: 'sc-no' }, String(i + 1)),
                    h('span', { className: 'sc-tx' }, line.length ? line : ' '))
                })),
      )
    }

    function MemoryPage() {
      const [view, setView] = useState('decay')
      const [rows, setRows] = useState(null)
      const [err, setErr] = useState(null)
      const [onlyExpiring, setOnlyExpiring] = useState(false)
      const [note, setNote] = useState(null)
      const [busyId, setBusyId] = useState(null)

      const loadRows = useCallback(function () {
        return loadFileLines('decay').then(function (lines) {
          const out = []
          for (const line of lines || []) {
            if (!line || !line.trim()) continue
            let rec
            try { rec = JSON.parse(line) } catch (e) { continue }
            out.push(rec)
          }
          out.sort(function (a, b) {
            const ia = Number(a.imp) || 0
            const ib = Number(b.imp) || 0
            if (ib !== ia) return ib - ia
            return (Number(b.clarity) || 0) - (Number(a.clarity) || 0)
          })
          setRows(out)
        }, function (e) { setErr(String((e && e.message) || e)) })
      }, [])

      useEffect(function () { loadRows() }, [loadRows])

      // 审计流水：谁在什么时候把哪条的 imp 从几改成几
      const [logRows, setLogRows] = useState([])
      const loadLog = useCallback(function () {
        return apiGet({ action: 'imp-log' }).then(function (res) {
          if (res && res.ok) setLogRows(res.rows || [])
        }, function () {})
      }, [])
      useEffect(function () { loadLog() }, [loadLog])

      // 改 imp：只改"意图"，写入和审计都在 memctl 里；这里只管把结果说出来
      const changeImp = function (r, next) {
        setBusyId(r.id)
        apiPost({ action: 'imp-set', id: r.id, imp: Number(next) }).then(function (res) {
          setBusyId(null)
          setNote({ ok: !!(res && res.ok), text: (res && res.output) || (res && res.error) || '没返回' })
          loadRows()
          loadLog()
        }, function (e) {
          setBusyId(null)
          setNote({ ok: false, text: String((e && e.message) || e) })
        })
      }

      if (view === 'long') {
        return h('div', { className: 'sc-page' },
          h(PageHeading, { name: 'memory' }, COPY.memory.title),
          h('p', { className: 'sc-lead' }, COPY.memory.pageLead),
          h('div', { className: 'sc-memory-panel' },
            h(MemoryTabs, { view: view, onChange: setView }),
            h(LongTermView)))
      }

      if (err) return h('div', { className: 'sc-page' }, h('div', { className: 'sc-note sc-note-bad' }, err))
      if (!rows) return h('div', { className: 'sc-page' }, h('div', { className: 'sc-empty' }, COPY.memory.loading))

      const activeRows = rows.filter(function (r) { return r.state !== 'archived' })
      const archivedCount = rows.length - activeRows.length
      const strong = activeRows.filter(function (r) { return (Number(r.imp) || 0) >= 4 }).length
      const expiring = activeRows.filter(function (r) { return exitDays(r) != null }).length
      const dist = {}
      activeRows.forEach(function (r) {
        const n = Math.min(5, Math.max(1, Number(r.imp) || 0))
        dist[n] = (dist[n] || 0) + 1
      })
      const shown = onlyExpiring ? activeRows.filter(function (r) { return exitDays(r) != null }) : rows

      // 按 imp 分组的平铺表：同 imp 连续的一段前插一行组头，方便成批处理
      const grouped = []
      shown.forEach(function (r, i) {
        const imp = Number(r.imp) || 0
        if (i === 0 || Number(shown[i - 1].imp) !== imp) {
          grouped.push({ head: true, imp: imp, count: shown.filter(function (x) { return Number(x.imp) === imp }).length })
        }
        grouped.push({ head: false, r: r, i: i })
      })

      return h('div', { className: 'sc-page' },
        h(PageHeading, { name: 'memory' }, COPY.memory.decayTitle),
        h('p', { className: 'sc-lead' }, COPY.memory.pageLead),
        h('div', { className: 'sc-memory-panel' },
          h(MemoryTabs, { view: view, onChange: setView }),
          h('p', { className: 'sc-lead' }, fmt(COPY.memory.lead, { n: rows.length, active: activeRows.length, archived: archivedCount, strong: strong })),
          h('p', { className: 'sc-lead' }, fmt(COPY.memory.lead2, { expiring: expiring })),
          h('p', { className: 'sc-lead' }, COPY.memory.lead3),
          h('div', { className: 'sc-dist' },
            h('div', { className: 'sc-dist-label' }, 'imp 分布 · 活跃 ' + activeRows.length + ' 条'),
            h('div', { className: 'sc-dist-bar' },
              [5, 4, 3, 2, 1].map(function (n) {
                return h('span', { key: n, className: 'sc-dist-seg sc-fill-' + n, style: { flex: String(dist[n] || 0) } })
              })),
            h('div', { className: 'sc-dist-legend' },
              [5, 4, 3, 2, 1].map(function (n) {
                return h('span', { key: n },
                  h('i', { className: 'sc-dist-dot sc-fill-' + n }),
                  String(n) + ' · ' + String(dist[n] || 0))
              }))),
        h('div', { className: 'sc-persona-bar' },
          h('button', {
            className: 'sc-btn' + (onlyExpiring ? ' sc-btn-p' : ''),
            onClick: function () { setOnlyExpiring(function (v) { return !v }) },
          }, onlyExpiring ? '只看会归档的（' + expiring + '）' : '全部（' + rows.length + '）')),
        note ? h('div', { className: 'sc-note' + (note.ok ? '' : ' sc-note-bad') }, note.text) : null,
        h('div', { className: 'sc-table-wrap' },
          h('table', { className: 'sc-table' },
            h('thead', null, h('tr', null,
              h('th', null, 'imp'), h('th', null, '清晰度'), h('th', null, '内容'), h('th', null, '来源'), h('th', null, '距归档'))),
            h('tbody', null, grouped.map(function (g, gi) {
              if (g.head) {
                return h('tr', { key: 'h' + gi, className: 'sc-group' },
                  h('td', { colSpan: 5 }, 'imp ' + g.imp + ' · ' + g.count + ' 条'))
              }
              const r = g.r
              const imp = Number(r.imp) || 0
              const days = exitDays(r)
              const archived = r.state === 'archived'
              return h('tr', { key: r.id || g.i },
                h('td', null, h('select', {
                  className: 'sc-imp-sel sc-imp-' + Math.min(5, Math.max(1, imp)),
                  value: String(imp),
                  disabled: busyId === r.id,
                  title: archived ? '已归档；改 imp 会重新激活' : '改 imp：影响寿命和注入优先级',
                  onChange: function (e) { changeImp(r, e.target.value) },
                }, [5, 4, 3, 2, 1].map(function (n) {
                  return h('option', { key: n, value: String(n) }, String(n))
                }))),
                h('td', { className: 'sc-mono' }, (Number(r.clarity) || 0).toFixed(2)),
                h('td', null, r.text || ''),
                h('td', { className: 'sc-when sc-src-cell' }, r.src || ''),
                h('td', { className: 'sc-days ' + (archived ? 'sc-days-arch' : days == null ? 'sc-days-never' : days <= 7 ? 'sc-days-hot' : days <= 30 ? 'sc-days-warm' : 'sc-days-cool') }, archived ? '已归档' : days == null ? '永不' : days + ' 天'))
            })))),
        logRows.length
          ? h('div', { className: 'sc-logbox' },
            h('div', { className: 'sc-memo-sec' }, '最近改动（' + logRows.length + ' 条，最新在上）'),
            logRows.slice(0, 12).map(function (x, i) {
              const at = String(x.at || '').slice(0, 16).replace('T', ' ')
              return h('div', { key: i, className: 'sc-logrow' },
                h('span', { className: 'sc-when' }, at),
                h('span', { className: 'sc-logimp' }, String(x.from) + ' → ' + String(x.to)),
                h('span', { className: 'sc-logtext' }, String(x.text || '')))
            }))
          : null,
        // 参数只读：这些常量决定寿命和注入，改它们要改 memctl.mjs —— 界面不提供第二份配置，
        // 否则又会变成"代码说 A、界面说 B"的分裂。
        h('div', { className: 'sc-logbox' },
          h('div', { className: 'sc-memo-sec' }, '当前参数（只读，改它要改 memctl.mjs）'),
          h('div', { className: 'sc-params' },
            h('span', null, 'imp5 / 4：0.02/天 · floor 0.40 · 永不'),
            h('span', null, 'imp3：0.05/天 · floor 0.15 · 90 天'),
            h('span', null, 'imp2 / 1：0.10/天 · floor 0 · 30 天'),
            h('span', null, '注入：800 字 · 配额 5:50% 4:35% 3:15% · 2/1 档不占'),
            h('span', null, '新近性：创建时间，半衰 14 天，最高加成 +60%')))),
      )
    }

    /** 常驻块说明：并进「人格」页 —— 它讲的就是 persona 的构成和每轮成本。 */
    // 字数**实时算**：硬编码过一次（纪律 78 → 381 没同步）。同一个数字写两处，必有一处是旧的。
    // 规则：`X：` 单独成段的算小节标题；开头「请以第一人称…」那句是收尾总纲，不属任何小节。
    function personaBlockChars(lines) {
      const paras = []
      let buf = []
      ;(lines || []).forEach(function (raw) {
        const line = String(raw == null ? '' : raw)
        if (!line.trim()) { if (buf.length) paras.push(buf); buf = [] }
        else buf.push(line.trim())
      })
      if (buf.length) paras.push(buf)

      const map = {}
      let last = ''
      paras.forEach(function (p) {
        const head = /^([^：:]{2,12})：$/.exec(p[0])
        if (head) {
          last = head[1]
          map[last] = (map[last] || 0) + p.slice(1).join('').length
          return
        }
        const joined = p.join('')
        if (/^请以第一人称/.test(joined)) map['角色扮演总纲'] = (map['角色扮演总纲'] || 0) + joined.length
        else if (last) map[last] = (map[last] || 0) + joined.length
        else map['(开头)'] = (map['(开头)'] || 0) + joined.length
      })
      return map
    }

    function PinBlockTable(props) {
      const chars = personaBlockChars(props && props.lines)
      const lookup = function (name) {
        if (chars[name] != null) return chars[name]
        const hit = Object.keys(chars).filter(function (k) { return name.indexOf(k) === 0 || k.indexOf(name) === 0 })[0]
        return hit ? chars[hit] : null
      }
      return h('div', { className: 'sc-table-wrap' },
        h('table', { className: 'sc-table' },
          h('thead', null, h('tr', null,
            h('th', null, '段落'), h('th', null, '为什么必须常驻'), h('th', null, '占用'))),
          h('tbody', null, PIN_BLOCKS.map(function (b) {
            const n = lookup(b.name)
            return h('tr', { key: b.name },
              h('td', null, b.name),
              h('td', { className: 'sc-when' }, b.why),
              h('td', { className: 'sc-when' }, n == null ? '—' : n + ' 字'))
          }))))
    }

    /** 一条「已处理」记录：收的标出去处，扔的标出理由。 */
    function DecidedRow(props) {
      const d = props.item
      const accepted = d.status === 'accepted'
      const time = String(d.decidedAt || '').replace('T', ' ').slice(5, 16)
      const where = accepted
        ? h('span', { className: 'sc-dest' },
          '→ ' + (d.to ? (d.section ? d.to + ' · ' + d.section : d.to) : 'decay'))
        : h('span', null, '理由：' + (d.reason || '—'))
      return h('div', { className: 'sc-done-row' },
        h('span', { className: 'sc-done-mark' + (accepted ? ' sc-ok' : ' sc-no') }, accepted ? '收' : '扔'),
        h('span', { className: 'sc-done-text' }, d.text || ''),
        h('span', { className: 'sc-done-meta' }, where, h('span', { className: 'sc-done-time' }, time)))
    }

    function Panel() {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [rejectingId, setRejectingId] = useState(null)
      const [reason, setReason] = useState('')
      const [showDone, setShowDone] = useState(true)
      const [tab, setTab] = useState('pending')
      const [decided, setDecided] = useState([])
      const [longFor, setLongFor] = useState(null)
      const [longTarget, setLongTarget] = useState('facts')
      const [longSection, setLongSection] = useState('关于他')
      const [longWording, setLongWording] = useState('')
      const [headings, setHeadings] = useState({ facts: [], voices: [] })
      const [view, setView] = useState({ key: null, title: null, path: '', data: null, loading: false })

      const load = useCallback(function () {
        return Promise.all([
          apiGet({ action: 'state' }),
          loadQueueLines().catch(function () { return null }),
        ]).then(function (out) {
          const res = out[0]
          if (res && res.ok) {
            setState(res.state)
            setError(null)
            // 队列文件里的记录更全（带 to / section），优先用它；读不到才退回 host 算好的
            if (out[1]) setDecided(parseQueueLines(out[1]).decided)
            else if (res.state && res.state.decided) setDecided(res.state.decided)
          } else {
            setError((res && res.error) || '读不到状态')
          }
        }, function (err) {
          setError(String((err && err.message) || err))
        })
      }, [])

      // ── 收进长期：选文件 + 选小节 ───────────────────────
      // 小节列表从目标文件的 `## ` 标题里取；真正的校验在 pending.mjs 里（找不到就拒写）。
      const openLong = useCallback(function (item) {
        setLongFor(item.id)
        setLongTarget('facts')
        setLongSection('关于他')
        setLongWording(item.text || '')
        if (!headings.facts.length) {
          Promise.all([
            apiGet({ action: 'file', file: 'facts' }).catch(function () { return null }),
            apiGet({ action: 'file', file: 'voices' }).catch(function () { return null }),
          ]).then(function (pair) {
            const facts = pair[0] && pair[0].ok ? parseHeadings(pair[0].lines) : []
            const voices = pair[1] && pair[1].ok ? parseHeadings(pair[1].lines) : []
            setHeadings({ facts: facts, voices: voices })
            setLongSection(pickSection('facts', facts))
          })
        }
      }, [headings])

      const pickSection = function (target, factsHeads) {
        const list = target === 'voices' ? (headings.voices || []) : (factsHeads || headings.facts || [])
        const keys = target === 'voices' ? ['对我的要求'] : ['关于他', '关于用户']
        const hits = (list || []).filter(function (h) { return keys.some(function (k) { return h.indexOf(k) >= 0 }) })
        if (hits.length) return hits[hits.length - 1]
        return (list && list[0]) || ''
      }

      const switchLongTarget = function (target) {
        setLongTarget(target)
        if (target !== 'self') setLongSection(pickSection(target))
      }

      useEffect(function () {
        load()
      }, [load])

      const openFile = useCallback(function (key, title, from) {
        setView(function (prev) {
          return {
            key: key,
            title: title,
            path: prev.key === key ? prev.path : '',
            data: prev.key === key ? prev.data : null,
            loading: true,
          }
        })
        apiGet({ action: 'file', file: key, from: from || 0 }).then(function (res) {
          setView(function (prev) {
            return Object.assign({}, prev, { loading: false, path: (res && res.path) || '', data: res })
          })
        }, function (err) {
          setView(function (prev) {
            return Object.assign({}, prev, { loading: false, data: { ok: false, error: String((err && err.message) || err) } })
          })
        })
      }, [])

      const act = useCallback(function (body, label) {
        setBusy(body.id || 'state')
        return apiPost(body).then(function (res) {
          setBusy(null)
          const ok = res && res.ok
          const raw = res && res.output ? res.output : (res && res.error ? res.error : '')
          const hint = !ok && raw.indexOf('unknown action') >= 0 ? '（host 还没加载这条接口，重启一下 harness）' : ''
          setNote({
            ok: ok,
            text: label + (ok ? '成功' : '失败') + (raw ? '：' + raw : '') + hint,
          })
          setRejectingId(null)
          setReason('')
          return load()
        }, function (err) {
          setBusy(null)
          setNote({ ok: false, text: label + '失败：' + String((err && err.message) || err) })
        })
      }, [load])

      useEffect(function () {
        if (!note) return undefined
        const timer = setTimeout(function () { setNote(null) }, 6000)
        return function () { clearTimeout(timer) }
      }, [note])

      if (!state && !error) {
        return h('div', { className: 'sc-root' }, h(Styles), h('div', { className: 'sc-empty' }, '读待审队列…'))
      }

      if (!state) {
        return h('div', { className: 'sc-root' }, h(Styles),
          h('div', { className: 'sc-empty' }, '读不到：' + error,
            h('br'),
            h('button', { className: 'sc-ghost', style: { marginTop: '12px' }, onClick: load }, '重试')))
      }

      const counts = state.counts || { pending: 0, accepted: 0, rejected: 0, lines: 0 }
      const items = state.pending || []
      const pathsOk = state.ok
      const personaChars = state.persona ? state.persona.chars : null

      return h('div', { className: 'sc-root' },
        h(Styles),
        h('header', { className: 'sc-head' },
          h('div', { className: 'sc-tabs sc-tabs-top' },
            TABS.map(function (t) {
              return h('button', {
                key: t[0],
                className: 'sc-tab' + (tab === t[0] ? ' sc-tab-on' : ''),
                onClick: function () { setTab(t[0]) },
              }, t[1])
            }),
            h('div', { className: 'sc-spacer' }),
            h('button', { className: 'sc-ghost', onClick: load, disabled: busy === 'state' }, busy === 'state' ? COPY.common.refreshing : COPY.common.refresh),
          ),
          tab === 'pending'
            ? h('div', null,
              h('div', { className: 'sc-title-row' },
                h('h1', { className: 'sc-title' },
                  h('span', { className: 'sc-h-icon', 'aria-hidden': 'true' }, PAGE_ICONS.pending()),
                  COPY.pending.title),
                h(Pill, { tone: pathsOk ? 'ok' : 'bad' }, pathsOk ? '路径正常' : '路径不对：' + (state.missing || []).join(' / ')),
                h(Pill, { tone: counts.pending ? 'warn' : undefined }, counts.pending + ' 条')),
              h('p', { className: 'sc-sub' }, COPY.pending.sub))
            : null,
          note ? h('div', { className: 'sc-note' + (note.ok ? '' : ' sc-note-bad') }, note.text) : null,
        ),
        tab === 'pending'
          ? h('div', { className: 'sc-body' },
          h('div', { className: 'sc-main' },
            h('div', { className: 'sc-readme', style: { marginTop: 0 } },
              h('div', { className: 'sc-readme-title' }, COPY.pending.entryTitle),
              h('p', { className: 'sc-lead', style: { margin: '2px 0 0' } }, COPY.pending.entryIntro),
              h('ul', { className: 'sc-bullets' },
                h('li', null, COPY.pending.entry1),
                h('li', null, COPY.pending.entry2),
                h('li', null, COPY.pending.entry3)),
              h('p', { className: 'sc-lead', style: { margin: '8px 0 0' } }, COPY.pending.entryNo),
              h('p', { className: 'sc-lead', style: { margin: '6px 0 0' } }, COPY.pending.entryPolicy)),
            items.length === 0
              ? h('div', { className: 'sc-empty-card' },
                h('div', { className: 'sc-empty-icon', 'aria-hidden': 'true' }, PAGE_ICONS.pending()),
                h('div', { className: 'sc-empty-title' }, COPY.pending.empty),
                h('div', { className: 'sc-empty-sub' }, '队列空时，新候选会先落在 memory/pending-facts.jsonl。'))
              : items.map(function (item) {
                return h(Card, {
                  key: item.id,
                  item: item,
                  busy: busy,
                  rejecting: rejectingId === item.id,
                  reason: reason,
                  onAccept: function (it, imp) { act({ action: 'accept', id: it.id, imp: imp }, '收进衰减层') },
                  onAskReject: function (it) { setRejectingId(it.id); setReason('') },
                  onCancelReject: function () { setRejectingId(null); setReason('') },
                  onReasonChange: setReason,
                  onReject: function (it) { act({ action: 'reject', id: it.id, reason: reason.trim() }, '扔掉') },
                  onPreviewPersona: function () { openFile('persona', 'persona.md') },
                  longOpen: longFor === item.id,
                  longTarget: longTarget,
                  longSection: longSection,
                  longWording: longWording,
                  longOptions: longTarget === 'voices' ? headings.voices : headings.facts,
                  onAskLong: openLong,
                  onLongTarget: switchLongTarget,
                  onLongSection: setLongSection,
                  onLongWording: setLongWording,
                  onLongCancel: function () { setLongFor(null); setLongWording('') },
                  onLongSubmit: function (it, imp) {
                    const to = longTarget
                    const section = to === 'self' ? '我学到的' : longSection
                    const wording = longWording.trim()
                    setLongFor(null)
                    act({ action: 'route', id: it.id, to: to, section: section, wording: wording || undefined, imp: imp }, '收进 ' + to)
                  },
                })
              }),
            h('div', { className: 'sc-warnbox' },
              h('b', null, '「升为常驻」的代价'),
              '：会写进 persona，',
              h('b', null, '每轮都付 token'),
              '（前提是部署把它放进了系统提示）。现在点它只把 persona 调出来给你看，不落盘（当前 ' + (personaChars == null ? '?' : personaChars) + ' 字 · 快照 ' + (state.snapshotCount == null ? '?' : state.snapshotCount) + ' 份）。',
            ),
            h('div', { className: 'sc-readme' },
              h('div', { className: 'sc-readme-title' }, '分层说明 · 什么内容该收进哪里'),
              h(LayerTable, null)),
            (decided.length
              ? h('div', { className: 'sc-done' },
                h('button', {
                  className: 'sc-done-toggle',
                  'aria-expanded': showDone,
                  onClick: function () { setShowDone(function (v) { return !v }) },
                }, h('span', { className: 'sc-caret' + (showDone ? ' sc-caret-open' : '') }, '▸'), '已处理 ' + decided.length + ' 条（扔掉的也留在队列里，带理由）'),
                showDone
                  ? h('div', { className: 'sc-done-body' }, decided.map(function (d, i) { return h(DecidedRow, { key: d.id || i, item: d }) }))
                  : null,
              )
              : null),
          ),
          view && view.key
            ? h(Viewer, {
              view: view,
              onBack: function () { setView({ key: null, title: null, path: '', data: null, loading: false }) },
              onMore: function () {
                if (!view.key || !view.data) return
                openFile(view.key, view.title, view.data.shown)
              },
            })
            : h(AuditPanel, null),
        )
          : (tab === 'search'
            ? h(SearchPage, null)
            : (tab === 'memo'
              ? h(MemoPage, null)
              : (tab === 'rules'
                ? h(RulesPage, null)
                : (tab === 'persona'
                  ? h(PersonaPage, { personaChars: personaChars })
                  : h(MemoryPage, null))))),
      )
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 20
      const [count, setCount] = useState(0)

      // 「防忘」的第一道保险：队列里有东西，侧栏就亮一下。
      // 45 秒一次，只读队列文件，不碰 persona / decay。
      useEffect(function () {
        let alive = true
        function tick() {
          loadQueueLines().then(function (lines) {
            if (!alive || !lines) return
            setCount(parseQueueLines(lines).pending.length)
          }, function () {})
        }
        tick()
        const timer = setInterval(tick, 45000)
        return function () {
          alive = false
          clearInterval(timer)
        }
      }, [])

      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('title', null, count > 0 ? count + ' 条待审' : '待审队列空着'),
      h('rect', { x: 3.5, y: 4, width: 17, height: 16, rx: 3.5 }),
      h('path', { d: 'M7.5 9h6' }),
      h('path', { d: 'M7.5 12.5h9' }),
      h('path', { d: 'M7.5 16h4.5' }),
      h('path', { d: 'M14.6 15.2l1.5 1.6 2.6-3' }),
      count > 0
        ? h('g', null,
          h('circle', {
            cx: 18.5, cy: 5.5, r: 5.4,
            fill: '#2f6feb',
            stroke: 'var(--dsw-specific-sidebar-fill, #fff)',
            strokeWidth: 1.8,
          }),
          count <= 9
            ? h('text', {
              x: 18.5, y: 8.2, textAnchor: 'middle',
              fontSize: 7.2, fontWeight: 700, fill: '#fff', stroke: 'none',
            }, String(count))
            : null)
        : null)
    }

    // 测试钩子（见文件末尾说明）：把闭包里的纯函数露给 unit-test.mjs。
    // 只读、不改变任何 UI 行为；浏览器里多挂一个全局对象而已。
    try {
      window.__animaInternals = {
        parseQueueLines, parseMemo, mdText, auditIsTableScaffold,
        buildDiff, exitDays, personaBlockChars,
      }
    } catch (e) { /* 非浏览器环境（测试）里没有 window 就跳过 */ }
    if (typeof globalThis !== 'undefined' && !globalThis.__animaInternals) {
      try { globalThis.__animaInternals = window && window.__animaInternals } catch (e) { /* noop */ }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: 'anima-fovenda' }, Panel)
        })
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'anima-fovenda',
            order: 7,
            label: 'Anima Fovenda',
          }, PanelIcon)
        })
      },
    }
  },
})

// 2026-11-08：测试钩子。上面 factory 里的纯函数（解析 / 比对 / 天数计算）不导出，
//   unit-test.mjs 就没法测**真代码**，只能测副本 —— 而副本一定漂移。
//   这里把它们挂出来，仅此一个用途；不给 UI 用，也不改任何行为。
//   注册在 factory 外层会拿不到闭包变量，所以由 factory 内部填充（见下）。
