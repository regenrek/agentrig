import process from 'node:process'

export function hasFlag(rawArgs: string[] | undefined, name: string) {
  return Boolean(rawArgs?.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`)))
}

export function isInteractiveTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}
