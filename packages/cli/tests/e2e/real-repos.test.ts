import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import inspectCommand from '../../src/commands/inspect'
import { REAL_REPO_CASES } from './real-repos.config'

type InspectReport = {
  digest: string
  source: {
    type: string
    label: string
    ref?: string
    commitSha?: string
  }
  signals: Array<{
    kind: string
    sourcePath: string
  }>
}

const RUN_REAL_REPOS = process.env.AGENTRIG_REAL_REPO_TESTS === '1'
const describeRealRepos = RUN_REAL_REPOS ? describe : describe.skip
const inspectRun = inspectCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<void>

describeRealRepos('real public agent repos', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  for (const repo of REAL_REPO_CASES) {
    it(`inspects ${repo.source} (${repo.description})`, async () => {
      const logs: string[] = []
      vi.spyOn(console, 'log').mockImplementation((line = '') => logs.push(String(line)))

      await inspectRun({
        args: {
          source: repo.source,
          json: true,
          ref: undefined,
          path: undefined,
          'only-kind': undefined,
          help: false,
        },
      })

      const report = JSON.parse(logs.at(-1) ?? '') as InspectReport
      expect(report.source.type).toBe('github')
      expect(report.source.label).toBe(`https://github.com/${repo.source}`)
      expect(report.source.ref).toBeTruthy()
      expect(report.source.commitSha).toMatch(/^[a-f0-9]{40}$/)
      expect(report.digest).toMatch(/^[a-f0-9]{64}$/)
      expect(report.signals.length).toBeGreaterThanOrEqual(repo.minSignals)
      expect(report.signals.every((signal) => signal.sourcePath.length > 0)).toBe(true)
    }, Number.parseInt(process.env.AGENTRIG_REAL_REPO_TEST_TIMEOUT_MS ?? '180000', 10))
  }
})
