import { describe, expect, it } from 'vite-plus/test'
import { providerCompatForSignal } from '../../src/provider/affinity'

describe('provider affinity', () => {
  it('maps known provider-native paths to expected compatibility', () => {
    expect(providerCompatForSignal('skill', 'skills/review')).toEqual({
      claude: 'native',
      codex: 'native',
      cursor: 'native',
    })
    expect(providerCompatForSignal('command', '.claude/commands/review.md')).toEqual({
      claude: 'native',
      codex: 'port',
      cursor: 'port',
    })
    expect(providerCompatForSignal('command', '.codex/prompts/fix.md')).toEqual({
      claude: 'port',
      codex: 'native',
      cursor: 'port',
    })
    expect(providerCompatForSignal('command', '.cursor/commands/fix.md')).toEqual({
      claude: 'port',
      codex: 'port',
      cursor: 'native',
    })
    expect(providerCompatForSignal('command', 'commands/fix.md')).toEqual({
      claude: 'port',
      codex: 'port',
      cursor: 'port',
    })
    expect(providerCompatForSignal('codex-app', '.app.json')).toEqual({
      claude: 'unsupported',
      codex: 'native',
      cursor: 'unsupported',
    })
  })
})
