-- SCARECROW Scanner V3 community database (Cloudflare D1 / SQLite)
-- Apply ONCE to the intended D1 database before enabling V3 community writes.
-- No wallet addresses, raw IPs, emails, or arbitrary browser identifiers are stored.

CREATE TABLE IF NOT EXISTS community_votes (
  mint TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('legit', 'concern')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (mint, voter_hash)
);
CREATE INDEX IF NOT EXISTS idx_community_votes_mint_choice ON community_votes(mint, choice);
CREATE INDEX IF NOT EXISTS idx_community_votes_actor_date ON community_votes(voter_hash, created_at);

CREATE TABLE IF NOT EXISTS community_submissions (
  mint TEXT NOT NULL,
  submitter_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (mint, submitter_hash)
);
CREATE INDEX IF NOT EXISTS idx_community_submissions_recent ON community_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_submissions_actor_date ON community_submissions(submitter_hash, created_at);

CREATE TABLE IF NOT EXISTS community_suggestions (
  id TEXT PRIMARY KEY,
  author_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('feature', 'bug', 'data', 'other')),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 15 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_community_suggestions_actor_date ON community_suggestions(author_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_community_suggestions_public ON community_suggestions(status, created_at DESC);
