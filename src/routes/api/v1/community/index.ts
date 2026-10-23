import { createFileRoute } from '@tanstack/react-router'
// @ts-expect-error Server-only JS library has no TS declaration.
import { communityFeed, validateMint } from '../../../../server-core/community.mjs'
// @ts-expect-error Worker-specific loader has no TS declaration.
import { bindings } from '../../../../server-core/community-runtime.mjs'
// @ts-expect-error An anonymous signed cookie is handled on the server.
import { anonymousVisitor, reply } from '../../../../server-core/community-auth.mjs'

export const Route = createFileRoute('/api/v1/community/')({
  server: { handlers: {
    GET: async ({ request }) => {
      const mintParam = new URL(request.url).searchParams.get('mint')
      let mint: string | null = null
      try { if (mintParam) mint = validateMint(mintParam) } catch { return reply({ error: 'Invalid mint' }, 400) }
      const { db, secret } = await bindings()
      if (!db) return reply({ ready: false, error: 'Community database is not connected yet' }, 503)
      try {
        const visitor = await anonymousVisitor(request, secret)
        return reply({ ...(await communityFeed(db, mint, visitor?.hash)), writeEnabled: typeof secret === 'string' && secret.length >= 32 })
      } catch (error) {
        console.error('Community feed failed', error instanceof Error ? error.message : 'unknown')
        return reply({ ready: false, error: 'Community feed temporarily unavailable' }, 503)
      }
    },
  } },
})
