export type TemplateVars = Record<string, string>

export function renderTemplate(input: string, vars: TemplateVars) {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`
  })
}
