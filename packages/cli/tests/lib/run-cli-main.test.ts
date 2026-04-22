import { describe, expect, it, vi } from 'vite-plus/test'
import { runCliMain } from '../../src/lib/run-cli-main'

class ExitCalled extends Error {
  readonly code: number
  constructor(code: number) {
    super(`exit:${code}`)
    this.code = code
  }
}

function makeExit() {
  const calls: number[] = []
  const exit = ((code: number): never => {
    calls.push(code)
    throw new ExitCalled(code)
  }) as (code: number) => never
  return { calls, exit }
}

function makeLogger() {
  const messages: string[] = []
  const logError = (message: string) => {
    messages.push(message)
  }
  return { messages, logError }
}

describe('runCliMain', () => {
  it('prints a clean single-line message and exits 1 on Error', async () => {
    const { calls, exit } = makeExit()
    const { messages, logError } = makeLogger()

    const runCommand = vi.fn(async () => {
      throw new Error('Not logged in. Run `agentrig login` first.')
    })

    await expect(
      runCliMain({
        main: { meta: { name: 'agentrig' }, run: () => undefined } as any,
        runCommand: runCommand as any,
        showUsage: vi.fn() as any,
        meta: { version: '0.0.0' },
        rawArgs: ['whoami'],
        exit,
        logError,
      }),
    ).rejects.toBeInstanceOf(ExitCalled)

    expect(messages).toEqual(['Not logged in. Run `agentrig login` first.'])
    expect(calls).toEqual([1])
  })

  it('prints the non-error value untouched', async () => {
    const { calls, exit } = makeExit()
    const { messages, logError } = makeLogger()

    const runCommand = vi.fn(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'Raw failure text'
    })

    await expect(
      runCliMain({
        main: { meta: { name: 'agentrig' }, run: () => undefined } as any,
        runCommand: runCommand as any,
        showUsage: vi.fn() as any,
        meta: { version: '0.0.0' },
        rawArgs: ['submit'],
        exit,
        logError,
      }),
    ).rejects.toBeInstanceOf(ExitCalled)

    expect(messages).toEqual(['Raw failure text'])
    expect(calls).toEqual([1])
  })

  it('prints version on --version without invoking runCommand', async () => {
    const { calls, exit } = makeExit()
    const { messages, logError } = makeLogger()
    const runCommand = vi.fn(async () => {})
    const showUsage = vi.fn()
    const logs: string[] = []
    const originalLog = console.log
    console.log = (value: unknown) => {
      logs.push(String(value))
    }
    try {
      await runCliMain({
        main: { meta: { name: 'agentrig' }, run: () => undefined } as any,
        runCommand: runCommand as any,
        showUsage: showUsage as any,
        meta: { version: '1.2.3' },
        rawArgs: ['--version'],
        exit,
        logError,
      })
    } finally {
      console.log = originalLog
    }

    expect(logs).toEqual(['1.2.3'])
    expect(runCommand).not.toHaveBeenCalled()
    expect(showUsage).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(messages).toEqual([])
  })
})
