import process from 'node:process'
import { spawn } from 'node:child_process'

function getOpenCommand(url: string) {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] }
  }
  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] }
  }
  return { command: 'xdg-open', args: [url] }
}

export async function openExternalUrl(url: string) {
  const { command, args } = getOpenCommand(url)
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    })

    const fail = () => resolve(false)
    const succeed = () => {
      child.unref()
      resolve(true)
    }

    child.once('error', fail)
    child.once('spawn', succeed)
  })
}
