import { expect, mock, test } from 'claude-code/testing'

const TREE = JSON.stringify([
  { id: 'r', parent: '', title: 'Root', status: 'open', age: '1m', depth: 0, prefix: '' },
  { id: 'f', parent: 'r', title: 'fork topic', status: 'open', age: '1m', depth: 1, prefix: '└─ ' },
])

test('/merge writes the summary via cct and resumes the parent', async ($, on) => {
  // Hooks on a $ call answer { value }; they stand in for the engine and the cct script.
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const resumed: string[] = []
  const contexts: (readonly string[] | undefined)[] = []
  let inbox = 'Sub-conversations forked from this one were closed while you were away:\n### x'
  const logs: unknown[] = []
  on('ui.log', ($, e) => {
    logs.push(e)
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'f' }))
  on('session.root', () => ({ value: '/x/repo' }))
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('process.run', ($, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const [, sub, , flag] = e.argv
    if (sub === 'inbox' && flag === '--ack') inbox = ''
    const stdout =
      { tree: TREE, merge: 'merged into Root [r]', inbox, summary: '**Outcome:** done\n' }[sub ?? ''] ?? ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('command.run', { command: 'resume' }, ($, e) => {
    resumed.push(e.args)
    return { text: '' } as never
  })

  // The inbox rides along with the first prompt only.
  await $.prompt.submit({ text: 'hi' })
  await $.prompt.submit({ text: 'again' })
  expect(logs).toEqual([])
  expect(contexts.map(c => c?.length ?? 0)).toEqual([1, 0])
  await $.command.run({ command: 'threads', args: '' })

  const band = await $.ui.mount({
    plugin: 'cct-threads',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
  })
  expect(await band.find({ key: 'merge' })).toBeDefined()
  await $.command.run({ command: 'merge', args: '' })

  const pane = await $.ui.mount({
    plugin: 'cct-threads',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cct-threads',
    props: { title: 'Threads', isFocused: true, bodyColumns: 100, placement: 'inline' } as never,
  })
  // /merge hands the summary to a timer so it outlives the command; let it run.
  await clock.advance(0)
  expect(await pane.find({ type: 'Text', text: /Outcome/ })).toBeDefined()
  await pane.press({ key: 'yes' })

  const merge = runs.find(r => r.argv[1] === 'merge')
  expect(merge?.argv).toEqual(['cct', 'merge', 'f', '--stay'])
  expect(merge?.stdin).toBe('**Outcome:** done')
  expect(resumed).toEqual(['r'])
})
