import { isSolanaAddress } from './validation.mjs'

const num = (value) => Math.max(0, Number(value || 0))
const recentCutoff = () => Math.floor(Date.now() / 1000) - 86400

export function validateMint(value) {
  if (typeof value !== 'string' || !isSolanaAddress(value.trim())) throw new Error('Enter a valid Solana token mint')
  return value.trim()
}
export function validateChoice(value) {
  if (value !== 'legit' && value !== 'concern') throw new Error('Choose LEGIT or CONCERN')
  return value
}
export function validateLabel(value) {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > 50) throw new Error('Token label must be 50 characters or fewer')
  return value.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, 40)
}
export function validateSuggestion(kind, message) {
  if (!['feature', 'bug', 'data', 'other'].includes(kind)) throw new Error('Choose a suggestion type')
  if (typeof message !== 'string') throw new Error('Describe your suggestion')
  const trimmed = message.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()
  if (trimmed.length < 15 || trimmed.length > 500) throw new Error('Suggestion must be 15–500 characters')
  return { kind, message: trimmed }
}

async function dailyCount(db, table, col, hash) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ? AND created_at >= ?`).bind(hash, recentCutoff()).first()
  return num(row?.n)
}

export async function communityFeed(db, mint, visitorHash = null) {
  const recent = await db.prepare(`
    SELECT s.mint,
           (SELECT s2.label FROM community_submissions s2 WHERE s2.mint = s.mint ORDER BY s2.created_at DESC, s2.rowid DESC LIMIT 1) AS label,
           MAX(s.created_at) AS lastSubmittedAt, COUNT(*) AS submissions
    FROM community_submissions s GROUP BY s.mint
    ORDER BY lastSubmittedAt DESC LIMIT 12
  `).all()
  const approved = await db.prepare(`
    SELECT id, kind, message, created_at AS createdAt
    FROM community_suggestions WHERE status = 'approved'
    ORDER BY created_at DESC LIMIT 6
  `).all()
  let votes = { legit: 0, concern: 0, total: 0, myVote: null }
  if (mint) {
    const rows = await db.prepare(`SELECT choice, COUNT(*) AS n FROM community_votes WHERE mint = ? GROUP BY choice`).bind(mint).all()
    for (const row of rows.results || []) {
      if (row.choice === 'legit' || row.choice === 'concern') votes[row.choice] = num(row.n)
    }
    votes.total = votes.legit + votes.concern
    if (visitorHash) {
      const row = await db.prepare(`SELECT choice FROM community_votes WHERE mint = ? AND voter_hash = ?`).bind(mint, visitorHash).first()
      votes.myVote = row?.choice === 'legit' || row?.choice === 'concern' ? row.choice : null
    }
  }
  return {
    ready: true,
    recentSubmissions: (recent.results || []).map(({ mint, label, lastSubmittedAt, submissions }) => ({ mint, label, lastSubmittedAt: num(lastSubmittedAt), submissions: num(submissions) })),
    suggestions: approved.results || [],
    votes,
    disclaimer: 'Votes are anonymous browser reactions, not verified users, endorsements, or evidence of token safety.',
  }
}

export async function castVote(db, mint, choice, hash) {
  const existing = await db.prepare('SELECT choice FROM community_votes WHERE mint = ? AND voter_hash = ?').bind(mint, hash).first()
  if (existing) return { recorded: false, alreadyVoted: true, choice: existing.choice }
  if (await dailyCount(db, 'community_votes', 'voter_hash', hash) >= 30) throw new Error('Daily reaction limit reached')
  // Database uniqueness is authoritative across concurrent requests.
  const result = await db.prepare('INSERT OR IGNORE INTO community_votes(mint, voter_hash, choice) VALUES (?, ?, ?)').bind(mint, hash, choice).run()
  if (!result?.meta?.changes) {
    const prev = await db.prepare('SELECT choice FROM community_votes WHERE mint = ? AND voter_hash = ?').bind(mint, hash).first()
    return { recorded: false, alreadyVoted: true, choice: prev?.choice || null }
  }
  return { recorded: true, alreadyVoted: false, choice }
}

export async function submitToken(db, mint, label, hash) {
  const existing = await db.prepare('SELECT 1 AS found FROM community_submissions WHERE mint = ? AND submitter_hash = ?').bind(mint, hash).first()
  if (existing) return { recorded: false, alreadySubmitted: true }
  if (await dailyCount(db, 'community_submissions', 'submitter_hash', hash) >= 10) throw new Error('Daily submission limit reached')
  const result = await db.prepare('INSERT OR IGNORE INTO community_submissions(mint, submitter_hash, label) VALUES (?, ?, ?)').bind(mint, hash, label).run()
  return { recorded: Boolean(result?.meta?.changes), alreadySubmitted: !result?.meta?.changes }
}

export async function addSuggestion(db, kind, message, hash) {
  if (await dailyCount(db, 'community_suggestions', 'author_hash', hash) >= 3) throw new Error('Daily suggestion limit reached')
  const id = crypto.randomUUID()
  await db.prepare('INSERT INTO community_suggestions(id, author_hash, kind, message) VALUES (?, ?, ?, ?)').bind(id, hash, kind, message).run()
  return { id, status: 'pending' }
}
