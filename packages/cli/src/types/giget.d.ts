declare module 'giget' {
  export type DownloadTemplateOptions = {
    dir?: string
    force?: boolean
    auth?: string
  }

  export type DownloadTemplateResult = {
    dir: string
  }

  export function downloadTemplate(
    source: string,
    options?: DownloadTemplateOptions
  ): Promise<DownloadTemplateResult>
}
