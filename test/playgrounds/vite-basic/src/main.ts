const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Expected #app root element in Vite fixture')
}

app.innerHTML = `
  <main>
    <h1>Vite Basic Fixture</h1>
    <p>This project is copied into temporary directories for AgentRig E2E tests.</p>
  </main>
`
