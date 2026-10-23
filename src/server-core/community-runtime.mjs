// Runs ONLY in server handlers. Cloudflare D1 + Worker secret, never in client JS.
export async function bindings() {
  try {
    const { env } = await import('cloudflare:workers')
    return { db: env.SCARECROW_DB || null, secret: env.SCARECROW_SESSION_SECRET || '' }
  } catch {
    // Node local dev or a deployment that has not been configured yet.
    return { db: null, secret: '' }
  }
}
