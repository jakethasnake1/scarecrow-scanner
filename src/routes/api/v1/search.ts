import { createFileRoute } from '@tanstack/react-router'
// @ts-expect-error Reused server-only source connector has no TypeScript declarations.
import { searchSimilarTokens } from '../../../server-core/sources.mjs'
// @ts-expect-error Reused server-only validator has no TypeScript declarations.
import { isSolanaAddress } from '../../../server-core/validation.mjs'

type SearchItem = {
  mint: string
  name: string
  symbol: string
  liquidityUsd: number | null
  volume24hUsd: number | null
  marketCap: number | null
}
const cache = new Map<string, { until: number; value: unknown }>()
const safeNum = (v: unknown): number | null => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null

export const Route = createFileRoute('/api/v1/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = (new URL(request.url).searchParams.get('q') || '').trim()
        if (query.length < 2 || query.length > 60) return Response.json({ error: 'Token name or ticker must contain 2–60 characters' }, { status: 400 })
        const cached = cache.get(query.toLowerCase())
        if (cached && cached.until > Date.now()) return Response.json(cached.value)
        try {
          const data = await searchSimilarTokens(query)
          const result = new Map<string, SearchItem>()
          for (const pair of data) {
            for (const token of [pair.baseToken, pair.quoteToken]) {
              if (!token?.address || !isSolanaAddress(token.address)) continue
              const name = String(token.name ?? '').trim()
              const symbol = String(token.symbol ?? '').trim()
              if (!name.toLowerCase().includes(query.toLowerCase()) && !symbol.toLowerCase().includes(query.toLowerCase())) continue
              const candidate = {
                mint: token.address as string,
                name: name || 'Unnamed',
                symbol: symbol || '?',
                liquidityUsd: safeNum(pair?.liquidity?.usd),
                volume24hUsd: safeNum(pair?.volume?.h24),
                marketCap: safeNum(pair?.marketCap ?? pair?.fdv),
              }
              const previous = result.get(candidate.mint)
              if (!previous || (candidate.volume24hUsd ?? 0) > (previous.volume24hUsd ?? 0)) result.set(candidate.mint, candidate)
            }
          }
          const results = [...result.values()]
            .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
            .slice(0, 12)
          const response = { query, results, caveat: 'These are indexed search results sorted by 24H volume, NOT verified official tokens. Select the actual mint to be certain.' }
          cache.set(query.toLowerCase(), { until: Date.now() + 60_000, value: response })
          if (cache.size > 300) cache.clear()
          return Response.json(response)
        } catch (error) {
          console.error('Scarecrow token search error', error instanceof Error ? error.message : 'unknown')
          return Response.json({ error: 'Token search unavailable right now' }, { status: 502 })
        }
      },
    },
  },
})
