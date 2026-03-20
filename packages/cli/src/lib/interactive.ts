import process from 'node:process'
import * as readline from 'node:readline/promises'

export async function selectOption<T>(
  items: T[],
  render: (item: T, index: number) => string,
  prompt = 'Select an item by number'
) {
  if (items.length === 0) {
    throw new Error('No items available for selection.')
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive selection requires a TTY. Pass a submission id explicitly.')
  }

  for (const [index, item] of items.entries()) {
    console.log(`${index + 1}. ${render(item, index)}`)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    while (true) {
      const answer = (await rl.question(`${prompt}: `)).trim()
      const selected = Number.parseInt(answer, 10)
      if (Number.isFinite(selected) && selected >= 1 && selected <= items.length) {
        return items[selected - 1]
      }
      console.log(`Enter a number between 1 and ${items.length}.`)
    }
  } finally {
    rl.close()
  }
}
