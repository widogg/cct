import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MergeDraft, ThreadNode } from '../types'

// All tree logic lives in the `cct` script (bin/cct in this repo); this mod only draws and calls it.
const PANE = 'cct-threads'
const LIST_MAX = 30

const nodes = atom({ plugin: 'cct-threads', key: 'nodes' } as const, [] as ThreadNode[])
const filter = atom({ plugin: 'cct-threads', key: 'filter' } as const, '')
const draft = atom({ plugin: 'cct-threads', key: 'draft' } as const, null as MergeDraft | null)
const busy = atom({ plugin: 'cct-threads', key: 'busy' } as const, '')

type $ = EngineInterface

const cct = async ($: $, args: string[], init?: { stdin?: string; timeoutMs?: number }) => {
  const r = await $.process.run(['cct', ...args], init)
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `cct ${args[0]} exited ${r.exitCode}`)
  return r.stdout
}

const refresh = async ($: $) => {
  try {
    const tree = JSON.parse(await cct($, ['tree', '--json', await $.session.root(), 'all'])) as ThreadNode[]
    await update($, nodes, () => tree)
  } catch (err) {
    $.ui.log(`cct-threads: ${String(err)}`)
  }
}

// Current session, its ancestors (root first) and its open children.
const where = async ($: $) => {
  const list = await read($, nodes)
  const id = await $.session.id()
  const byId = new Map(list.map(n => [n.id, n]))
  const chain: ThreadNode[] = []
  for (let n = byId.get(id); n && chain.length < 50; n = byId.get(n.parent)) chain.unshift(n)
  const kids = list.filter(n => n.parent === id && n.status === 'open')
  return { id, chain, kids, parent: chain.at(-2) }
}

const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// In-place resume when the engine allows it; otherwise the cct loop picks it up after exit.
const jump = async ($: $, id: string) => {
  try {
    const r = await $.command.run({ command: 'resume', args: id })
    // /resume does not list headless (claude -p) sessions and reports that instead of failing.
    if (/no conversations found/i.test(r.text ?? '')) throw new Error('not resumable in place')
  } catch (err) {
    await cct($, ['next', id])
    $.ui.toast(`Exit Claude to jump (the cct loop resumes ${id.slice(0, 8)}). ${String(err)}`)
  }
}

const startMerge = async ($: $, mode: MergeDraft['mode']) => {
  const { parent } = await where($)
  if (!parent) return $.ui.toast('Root conversation: nothing to merge into')
  await update($, busy, () => 'Summarizing this conversation…')
  void $.ui.open({ id: PANE, title: 'Threads', focus: true, closeOnEscape: true })
  // Headless summary from the saved transcript: $.model.fork has nothing to fork right after a resume.
  let text = ''
  try {
    text = await cct($, ['summary', await $.session.id(), ...(mode === 'dropped' ? ['drop'] : [])], { timeoutMs: 300_000 })
  } catch (err) {
    $.ui.toast(`cct-threads: no summary (${String(err).slice(0, 120)})`)
  }
  await update($, busy, () => '')
  if (text.trim()) await update($, draft, () => ({ mode, text: text.trim() }))
}

const confirmMerge = async ($: $) => {
  const d = await read($, draft)
  const { id, parent } = await where($)
  if (!d || !parent) return
  try {
    $.ui.toast(await cct($, ['merge', id, ...(d.mode === 'dropped' ? ['drop'] : []), '--stay'], { stdin: d.text }))
  } catch (err) {
    return $.ui.toast(`cct-threads: ${String(err)}`)
  }
  await update($, draft, () => null)
  await $.ui.close({ id: PANE })
  await jump($, parent.id)
}

const openTree = async ($: $) => {
  await refresh($)
  await update($, filter, () => '')
  return $.ui.open({ id: PANE, title: 'Threads', focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'threads', description: 'Show this repo\'s conversation tree (cct)' })
    await $.command.register({
      name: 'merge',
      description: 'Merge this conversation into its parent and go there (drop: close it as abandoned)',
      argumentHint: '[drop]',
    })
    await refresh($)
    return next(e)
  })

  // Merge summaries addressed to this session ride along with its next prompt, acked once it entered.
  on('prompt.submit', async ($, e, next) => {
    const id = await $.session.id()
    let inbox = ''
    try {
      inbox = (await cct($, ['inbox', id])).trim()
    } catch (err) {
      $.ui.log(`cct-threads: ${String(err)}`)
    }
    if (!inbox) return next(e)
    const entered = await next({ ...e, context: [...(e.context ?? []), inbox] })
    if (!entered.drop) {
      await cct($, ['inbox', id, '--ack'])
      $.ui.toast('cct-threads: merged sub-conversation summaries added to this prompt')
    }
    return entered
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  // Same flow as the band's m/d: summary, confirm in the pane, then resume the parent.
  on('command.run', { command: 'merge' }, async ($, e) => {
    const mode = e.args.trim() === 'drop' ? 'dropped' : 'merged'
    if (!(await where($)).parent) return { text: 'Root conversation: nothing to merge into.' }
    // Opened here, the pane counts as asked for (any width); the summary runs on a timer so it outlives this hook.
    await update($, busy, () => 'Summarizing this conversation…')
    await $.ui.open({ id: PANE, title: 'Threads', focus: true, closeOnEscape: true })
    $.clock.after(0, () => void startMerge($, mode))
    return { text: 'Summarizing; confirm in the Threads pane (y/n).' }
  })

  on('command.run', { command: 'threads' }, async $ => {
    await openTree($)
    return { text: 'Threads pane opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { chain, kids, parent } = await where($)
    if (chain.length < 2 && kids.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // Hints only: the breadcrumb lives in the status line. One row, fzf's "key: action" style.
    return (
      <Box columnGap={2} flexWrap="nowrap">
        <Text dimColor wrap="truncate">ctrl-x tab, then</Text>
        <Button key="tree" label="tree" hotkey="t" plain onPress={() => openTree($)} />
        {parent && <Button key="merge" label="merge" hotkey="m" plain onPress={() => startMerge($, 'merged')} />}
        {parent && <Button key="drop" label="drop" hotkey="d" plain onPress={() => startMerge($, 'dropped')} />}
        {parent && <Button key="parent" label="parent" hotkey="p" plain onPress={() => jump($, parent.id)} />}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const Input = 'Input' in ui ? ui.Input : undefined // not every surface has text fields
    const working = await read($, busy)
    if (working) return <Text dimColor>{working}</Text>

    const d = await read($, draft)
    if (d) {
      return (
        <Box flexDirection="column">
          <Text bold>{d.mode === 'merged' ? 'Merge' : 'Drop'} with this summary?</Text>
          <Text>{d.text}</Text>
          <Box gap={2}>
            <Button key="yes" label="write it and go to parent" hotkey="y" plain onPress={() => confirmMerge($)} />
            <Button key="no" label="cancel" hotkey="n" plain onPress={() => update($, draft, () => null)} />
          </Box>
        </Box>
      )
    }

    const { id } = await where($)
    const q = (await read($, filter)).trim()
    const showClosed = q.startsWith(':all')
    const needle = (showClosed ? q.slice(4) : q).trim().toLowerCase()
    const hidden = new Set<string>()
    for (const n of await read($, nodes)) {
      if ((!showClosed && n.status !== 'open') || hidden.has(n.parent)) hidden.add(n.id)
    }
    const shown = (await read($, nodes)).filter(n => !hidden.has(n.id) && n.title.toLowerCase().includes(needle))
    const glyph = (n: ThreadNode) => (n.status === 'merged' ? '✔' : n.status === 'dropped' ? '✗' : '●')

    return (
      <Box flexDirection="column">
        {Input && <Input
          key="filter"
          label="filter"
          placeholder=":all shows closed"
          value={q}
          autoFocus
          submitLabel="jump"
          onInput={(v: string) => update($, filter, () => v)}
          onSubmit={() => shown[0] && shown[0].id !== id && jump($, shown[0].id)}
        />}
        {shown.length === 0 && <Text dimColor>No conversations match.</Text>}
        {shown.slice(0, LIST_MAX).map(n => (
          <Button
            key={n.id}
            label={`${n.prefix}${glyph(n)} ${short(n.title, 60)}  ${n.age}${n.id === id ? '  ◀ here' : ''}`}
            plain
            onPress={() => n.id !== id && jump($, n.id)}
          />
        ))}
        {shown.length > LIST_MAX && <Text dimColor>{shown.length - LIST_MAX} more: narrow the filter</Text>}
      </Box>
    )
  })
}
