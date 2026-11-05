import { useEffect, useState } from 'preact/hooks'
import { parse } from 'valibot'

import { HealthSchema } from '../shared/health.ts'

import type { Health } from '../shared/health.ts'
import type { JSX } from 'preact'

async function fetchHealth(): Promise<Health> {
  const response = await fetch('/api/health')
  if (!response.ok) {
    throw new Error(`health check failed: ${String(response.status)}`)
  }
  const body: unknown = await response.json()
  return parse(HealthSchema, body)
}

type HealthState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly health: Health }
  | { readonly kind: 'failed' }

function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ kind: 'loading' })
  useEffect((): void => {
    async function load(): Promise<void> {
      try {
        setState({ kind: 'ok', health: await fetchHealth() })
      } catch {
        setState({ kind: 'failed' })
      }
    }
    void load()
  }, [])
  return state
}

export function App(): JSX.Element {
  const health = useHealth()

  return (
    <main>
      <h1>www.wildshard.io</h1>
      <section aria-labelledby='status-heading'>
        <h2 id='status-heading'>Status</h2>
        <p>Nothing here yet.</p>
      </section>
      <footer>
        {health.kind === 'ok' && <small>v{health.health.version}</small>}
      </footer>
    </main>
  )
}
