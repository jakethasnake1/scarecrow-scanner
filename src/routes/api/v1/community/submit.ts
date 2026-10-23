import { createFileRoute } from '@tanstack/react-router'
// @ts-expect-error Server-only JS library.
import { submitToken, validateLabel, validateMint } from '../../../../server-core/community.mjs'
// @ts-expect-error Worker-specific loader.
import { bindings } from '../../../../server-core/community-runtime.mjs'
// @ts-expect-error Server-side anonymous session helpers.
import { anonymousVisitor, limitedJson, mutationAllowed, reply } from '../../../../server-core/community-auth.mjs'

export const Route = createFileRoute('/api/v1/community/submit')({
  server: { handlers: {
    POST: async ({ request }) => {
      if (!mutationAllowed(request)) return reply({ error: 'Same-origin JSON request required' }, 403)
      const { db, secret } = await bindings()
      if (!db || !secret || secret.length < 32) return reply({ error: 'Token submissions are not configured yet' }, 503)
      try {
        const data = await limitedJson(request)
        const mint = validateMint(data.mint)
        const label = validateLabel(data.label)
        const visitor = await anonymousVisitor(request, secret, true)
        const result = await submitToken(db, mint, label, visitor.hash)
        return reply(result, 200, visitor.setCookie)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Submission unavailable'
        if (message.includes('Daily')) return reply({ error: message }, 429)
        if (/^(Enter|Token label|Invalid|Payload|Missing)/.test(message)) return reply({ error: message }, 400)
        console.error('Community submit failed', message)
        return reply({ error: 'Token submission could not be saved' }, 503)
      }
    },
  } },
})
