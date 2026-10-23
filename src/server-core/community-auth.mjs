// An anonymous browser cookie, signed by the server. Not one-person-one-vote.
const COOKIE = '__Host-scarecrow_sid'
const enc = new TextEncoder()
const hex = (bytes) => [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('')
const getKey = async (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

async function mac(value, secret) {
  const key = await getKey(secret)
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))))
}

function extractCookie(request) {
  const line = request.headers.get('cookie') || ''
  for (const piece of line.split(';')) {
    const [name, ...value] = piece.trim().split('=')
    if (name === COOKIE) return value.join('=')
  }
  return ''
}

export async function anonymousVisitor(request, secret, create = false) {
  if (typeof secret !== 'string' || secret.length < 32) return null
  let sid = null
  const parts = extractCookie(request).split('.')
  if (parts.length === 2 && /^[a-f0-9]{32}$/.test(parts[0]) && /^[a-f0-9]{64}$/.test(parts[1])) {
    const key = await getKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, Uint8Array.from(parts[1].match(/../g), h => parseInt(h, 16)), enc.encode(parts[0]))
    if (ok) sid = parts[0]
  }
  let setCookie = null
  if (!sid && create) {
    sid = hex(crypto.getRandomValues(new Uint8Array(16)))
    setCookie = `${COOKIE}=${sid}.${await mac(sid, secret)}; Max-Age=15552000; Path=/; Secure; HttpOnly; SameSite=Lax`
  }
  return { hash: sid ? await mac(`community:${sid}`, secret) : null, setCookie }
}

export function mutationAllowed(request) {
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) return false
  return (request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')
}

export async function limitedJson(request, maxBytes = 2048) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new Error('Payload is too large')
  if (!request.body) throw new Error('Missing payload')
  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel(); throw new Error('Payload is too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data))
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid JSON object')
    return parsed
  } catch { throw new Error('Invalid JSON object') }
}

export function reply(data, status = 200, setCookie = null) {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
  if (setCookie) headers['set-cookie'] = setCookie
  return Response.json(data, { status, headers })
}
