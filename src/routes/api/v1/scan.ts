import { createFileRoute } from '@tanstack/react-router'
// Scanner engine is intentionally server-only. No wallet permissions or signing code.
// @ts-expect-error JS scanner module is imported unchanged from the separately tested MVP.
import { scan } from '../../../server-core/scanner.mjs'
// @ts-expect-error JS address validator is part of the backend MVP.
import { isSolanaAddress } from '../../../server-core/validation.mjs'

const cache = new Map<string, { until: number; value: unknown }>()
const pending = new Map<string, Promise<unknown>>()

export const Route = createFileRoute('/api/v1/scan')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const mint = (url.searchParams.get('mint') || '').trim()
        if (!isSolanaAddress(mint)) return Response.json({ error: 'Provide a valid Solana token mint (base58 public key)' }, { status: 400 })
        const now = Date.now()
        const existing = cache.get(mint)
        if (existing && existing.until > now) return Response.json(existing.value)
        try {
          let work = pending.get(mint)
          if (!work) {
            work = scan(mint)
            pending.set(mint, work)
          }
          const value = await work
          pending.delete(mint)
          cache.set(mint, { until: Date.now() + 90_000, value })
          if (cache.size > 300) cache.clear()
          return Response.json(value)
        } catch (error) {
          pending.delete(mint)
          console.error('Scarecrow scan error', error instanceof Error ? error.message : 'unknown')
          return Response.json({ error: 'Scanning service unavailable. Try again.' }, { status: 502 })
        }
      },
    },
  },
})
