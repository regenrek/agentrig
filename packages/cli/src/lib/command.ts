export function shouldShowParentUsage(rawArgs?: string[]) {
  return !(rawArgs ?? []).some((arg) => !arg.startsWith('-'))
}
