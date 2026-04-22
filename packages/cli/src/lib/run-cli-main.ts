import type { ArgsDef, CommandDef } from 'citty'

type AnyCommand = CommandDef<any>
type RunCommandFn = (cmd: AnyCommand, opts: { rawArgs: string[] }) => Promise<unknown>
type ShowUsageFn = (cmd: AnyCommand, parent?: AnyCommand) => Promise<void> | void

export type RunCliMainOptions = {
  main: AnyCommand
  runCommand: RunCommandFn
  showUsage: ShowUsageFn
  meta: {
    version: string
  }
  rawArgs?: string[]
  exit?: (code: number) => never
  logError?: (message: string) => void
}

async function resolveCommandValue<TArgs extends ArgsDef>(
  value: CommandDef<TArgs> | (() => CommandDef<TArgs>) | Promise<CommandDef<TArgs>>,
): Promise<CommandDef<TArgs>> {
  return typeof value === 'function'
    ? await (value as () => Promise<CommandDef<TArgs>>)()
    : await value
}

async function resolveSubCommand(
  cmd: AnyCommand,
  rawArgs: string[],
  parent?: AnyCommand,
): Promise<[AnyCommand, AnyCommand | undefined]> {
  const rawSubCommands = cmd.subCommands
  const subCommands =
    rawSubCommands && typeof rawSubCommands === 'object'
      ? (rawSubCommands as Record<string, AnyCommand | (() => Promise<AnyCommand>) | Promise<AnyCommand>>)
      : null
  if (subCommands && Object.keys(subCommands).length > 0) {
    const subCommandArgIndex = rawArgs.findIndex((arg) => !arg.startsWith('-'))
    const subCommandName = rawArgs[subCommandArgIndex]
    const subEntry = subCommandName ? subCommands[subCommandName] : undefined
    if (subEntry) {
      const subCommand = await resolveCommandValue(subEntry as AnyCommand)
      if (subCommand) {
        return resolveSubCommand(subCommand, rawArgs.slice(subCommandArgIndex + 1), cmd)
      }
    }
  }
  return [cmd, parent]
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

export async function runCliMain(options: RunCliMainOptions) {
  const rawArgs = options.rawArgs ?? process.argv.slice(2)
  const exit = options.exit ?? ((code: number): never => process.exit(code))
  const logError = options.logError ?? ((message: string) => console.error(message))

  try {
    if (rawArgs.length === 1 && rawArgs[0] === '--version') {
      console.log(options.meta.version)
      return
    }
    if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
      const [cmd, parent] = await resolveSubCommand(options.main, rawArgs)
      await options.showUsage(cmd, parent)
      return
    }
    await options.runCommand(options.main, { rawArgs })
  } catch (error) {
    logError(formatError(error))
    return exit(1)
  }
}
