import './style.css'
import { setupCounter } from './counter.ts'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Expected #app root element in Vite+ fixture')
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">AgentRig E2E Fixture</p>
    <h1>Vite+ application baseline</h1>
    <p class="body">
      This project is copied into temporary directories and validated before AgentRig export/install checks run.
    </p>
    <button id="counter" type="button" class="counter"></button>
  </main>
`

const counter = document.querySelector<HTMLButtonElement>('#counter')

if (!counter) {
  throw new Error('Expected #counter button in Vite+ fixture')
}

setupCounter(counter)
