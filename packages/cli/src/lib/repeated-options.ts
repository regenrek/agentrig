export function listRepeatedOptionValues(value: unknown, rawArgs: string[] | undefined, optionName: string): string[] {
  const rawValues = collectRawOptionValues(rawArgs ?? [], optionName)
  const parsedValues = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)]
  const seen = new Set<string>()
  const values: string[] = []
  for (const item of [...rawValues, ...parsedValues].flatMap((entry) => entry.split(','))) {
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    values.push(normalized)
  }
  return values
}

function collectRawOptionValues(rawArgs: string[], optionName: string): string[] {
  const values: string[] = []
  const longOption = `--${optionName}`
  const longOptionPrefix = `${longOption}=`
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (arg === longOption) {
      const next = rawArgs[index + 1]
      if (next && !next.startsWith('-')) {
        values.push(next)
        index += 1
      }
      continue
    }
    if (arg.startsWith(longOptionPrefix)) {
      values.push(arg.slice(longOptionPrefix.length))
    }
  }
  return values
}
