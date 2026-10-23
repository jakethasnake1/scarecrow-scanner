import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateMint, validateChoice, validateLabel, validateSuggestion,
  castVote, submitToken, addSuggestion, communityFeed,
} from '../src/server-core/community.mjs'
import { anonymousVisitor, mutationAllowed, limitedJson } from '../src/server-core/community-auth.mjs'

const mint = 'GtV6g1ey2NERrcbvL5bdzrxRJQDfxpMaLU9oLtRipump'
const secret = 'this-is-a-test-secret-longer-than-thirty-two-characters-001'

class FakeD1 {
  constructor() { this.votes = []; this.submissions = []; this.suggestions = [] }
  prepare(sql) {
    const db = this
    return {
      bind(...params) {
        return {
          async first() {
            if (sql.includes('COUNT(*) AS n')) {
              const table = sql.includes('community_votes') ? db.votes : sql.includes('community_submissions') ? db.submissions : db.suggestions
              const actor = sql.includes('community_votes') ? 'voter_hash' : sql.includes('community_submissions') ? 'submitter_hash' : 'author_hash'
              return { n: table.filter(r => r[actor] === params[0]).length }
            }
            if (sql.includes('community_votes')) return db.votes.find(r => r.mint === params[0] && r.voter_hash === params[1]) || null
            if (sql.includes('community_submissions')) return db.submissions.find(r => r.mint === params[0] && r.submitter_hash === params[1]) || null
            return null
          },
          async run() {
            if (sql.includes('INSERT OR IGNORE INTO community_votes')) {
              if (db.votes.some(r => r.mint === params[0] && r.voter_hash === params[1])) return { meta: { changes: 0 } }
              db.votes.push({ mint: params[0], voter_hash: params[1], choice: params[2] }); return { meta: { changes: 1 } }
            }
            if (sql.includes('INSERT OR IGNORE INTO community_submissions')) {
              if (db.submissions.some(r => r.mint === params[0] && r.submitter_hash === params[1])) return { meta: { changes: 0 } }
              db.submissions.push({ mint: params[0], submitter_hash: params[1], label: params[2] }); return { meta: { changes: 1 } }
            }
            if (sql.includes('INSERT INTO community_suggestions')) { db.suggestions.push({ id: params[0], author_hash: params[1], kind: params[2], message: params[3], status: 'pending' }); return { meta: { changes: 1 } } }
            throw new Error('Unexpected SQL: ' + sql)
          },
          async all() {
            if (sql.includes('community_votes')) {
              const counts = { legit: 0, concern: 0 }
              for (const v of db.votes) if (v.mint === params[0]) counts[v.choice]++
              return { results: Object.entries(counts).map(([choice, n]) => ({ choice, n })).filter(r => r.n) }
            }
            throw new Error('Unexpected parameterized SQL')
          },
        }
      },
      async all() {
        if (sql.includes('community_submissions')) return { results: db.submissions.map(r => ({ mint: r.mint, label: r.label, lastSubmittedAt: 1234, submissions: 1 })) }
        if (sql.includes('community_suggestions')) return { results: db.suggestions.filter(r => r.status === 'approved').map(({ id, kind, message }) => ({ id, kind, message, createdAt: 1234 })) }
        throw new Error('Unexpected unbound SQL')
      },
    }
  }
}

test('strict mint and reaction validation', () => {
  assert.equal(validateMint(mint), mint)
  assert.throws(() => validateMint('not a token'))
  assert.throws(() => validateMint('javascript:alert(1)'))
  assert.equal(validateChoice('legit'), 'legit')
  assert.throws(() => validateChoice('scam'))
  assert.equal(validateLabel('<b>$CROW</b>'), 'b$CROW/b')
  assert.throws(() => validateLabel('x'.repeat(51)))
})
test('suggestions are validated and length capped', () => {
  assert.equal(validateSuggestion('feature', 'Please add older price history').kind, 'feature')
  assert.throws(() => validateSuggestion('scam', 'Some suggestion long enough'))
  assert.throws(() => validateSuggestion('feature', 'spam'))
  assert.throws(() => validateSuggestion('feature', 'x'.repeat(501)))
})
test('signed cookie is server-verifiable, stable and tamper detectable', async () => {
  const initial = new Request('https://scarecrow.example/api/v1/community/vote')
  const generated = await anonymousVisitor(initial, secret, true)
  assert.ok(generated.setCookie.startsWith('__Host-scarecrow_sid='))
  assert.match(generated.setCookie, /HttpOnly; SameSite=Lax/)
  const cookie = generated.setCookie.split(';')[0]
  const verified = await anonymousVisitor(new Request(initial.url, { headers: { cookie } }), secret)
  assert.equal(verified.hash, generated.hash)
  assert.equal(verified.setCookie, null)
  const bad = await anonymousVisitor(new Request(initial.url, { headers: { cookie: cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0') } }), secret)
  assert.equal(bad.hash, null)
  const nosession = await anonymousVisitor(initial, secret)
  assert.equal(nosession.hash, null)
  assert.equal(await anonymousVisitor(initial, 'weak-secret', true), null)
})
test('same-origin JSON validation and JSON size limit', async () => {
  const req = new Request('https://example.com/api/v1/community/vote', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify({mint}) })
  assert.equal(mutationAllowed(req), true)
  assert.equal((await limitedJson(req)).mint, mint)
  assert.equal(mutationAllowed(new Request('https://example.com/api/v1/community/vote', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' } })), false)
  await assert.rejects(() => limitedJson(new Request('https://example.com/', { method: 'POST', body: JSON.stringify({ message: 'x'.repeat(4096) }) }), 2048))
})
test('vote uniqueness, shared totals and per-browser idempotency', async () => {
  const db = new FakeD1()
  assert.deepEqual(await castVote(db, mint, 'legit', 'browser1'), { recorded: true, alreadyVoted: false, choice: 'legit' })
  assert.deepEqual(await castVote(db, mint, 'concern', 'browser1'), { recorded: false, alreadyVoted: true, choice: 'legit' })
  assert.equal((await castVote(db, mint, 'concern', 'browser2')).recorded, true)
  const feed = await communityFeed(db, mint, 'browser1')
  assert.deepEqual(feed.votes, { legit: 1, concern: 1, total: 2, myVote: 'legit' })
  assert.equal(db.votes.length, 2)
})
test('token submissions are deliberate, unique per browser, and visible in shared feed', async () => {
  const db = new FakeD1()
  assert.equal((await submitToken(db, mint, '$CROW', 'visitor')).recorded, true)
  assert.equal((await submitToken(db, mint, '$CROW', 'visitor')).alreadySubmitted, true)
  assert.equal((await communityFeed(db, mint)).recentSubmissions.length, 1)
})
test('ideas are queued for moderation; only approved suggestions appear publicly', async () => {
  const db = new FakeD1()
  const result = await addSuggestion(db, 'feature', 'Show more detailed volume history', 'visitor')
  assert.equal(result.status, 'pending')
  assert.equal((await communityFeed(db, mint)).suggestions.length, 0)
  db.suggestions[0].status = 'approved'
  assert.equal((await communityFeed(db, mint)).suggestions.length, 1)
})
test('daily soft limits apply to votes, token submissions, and suggestions', async () => {
  const db = new FakeD1()
  for (let i = 0; i < 30; i++) db.votes.push({ mint: 'example'+i, voter_hash: 'actor', choice: 'legit' })
  await assert.rejects(() => castVote(db, mint, 'legit', 'actor'), /Daily/)
  for (let i = 0; i < 10; i++) db.submissions.push({mint:'example'+i, submitter_hash:'actor'})
  await assert.rejects(() => submitToken(db, mint, '', 'actor'), /Daily/)
  for (let i = 0; i < 3; i++) db.suggestions.push({ id:String(i), author_hash: 'actor' })
  await assert.rejects(() => addSuggestion(db, 'feature', 'A valid suggestion for testing', 'actor'), /Daily/)
})
