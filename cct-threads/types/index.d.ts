export type ThreadNode = {
  id: string
  parent: string
  title: string
  status: 'open' | 'merged' | 'dropped'
  age: string
  depth: number
  prefix: string
}

export type MergeDraft = { mode: 'merged' | 'dropped'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'cct-threads': {
      nodes: ThreadNode[]
      filter: string
      draft: MergeDraft | null
      busy: string
    }
  }
}
