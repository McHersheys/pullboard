/** Indexed global fact identities, preserving the original lookup for unindexed legacy JSON [B29,C7]. */

/** Declare safe, nonunique indexes without rejecting legacy duplicate ids or invalid JSON. */
export function factIdentityIndexSql(table) {
  if (!['event', 'event_archive'].includes(table)) throw new TypeError('fact identity indexes require an event table');
  return `CREATE INDEX IF NOT EXISTS ${table}_fact_identity ON ${table} (json_extract(event_detail, '$.id'))
      WHERE event_kind = 'fact' AND json_valid(event_detail);
    CREATE INDEX IF NOT EXISTS ${table}_fact_legacy ON ${table} (event_id)
      WHERE event_kind = 'fact' AND NOT json_valid(event_detail);`;
}

/** Discover only the two supported physical partitions; archived identities remain globally reserved. */
function factTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('event', 'event_archive') ORDER BY name")
    .all().map(({ name }) => name);
}

/** Find additive indexes missing from a legacy board without executing any DDL. */
export function missingFactIdentityIndexes(db) {
  return factTables(db).filter((table) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)")
    .get(`${table}_fact_identity`, `${table}_fact_legacy`).n !== 2);
}

/** Install additive indexes only when the owning writable opener calls the hot-index path. */
export function ensureFactIdentityIndexes(db) {
  for (const table of missingFactIdentityIndexes(db)) db.exec(factIdentityIndexSql(table));
}

/**
 * Look up an identity without parsing every valid fact. Strict-invalid JSON can include legacy JSON5;
 * retain the original query for that history rather than silently ignoring it or changing its errors.
 */
export function factIdentityExists(db, id) {
  const tables = factTables(db);
  const legacy = tables.some((table) => {
    // SQLite can prefer the broad kind index even when the partial legacy index is empty.
    // Older/non-owning stores may not have this additive index yet; keep their original lookup.
    const indexed = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?")
      .get(`${table}_fact_legacy`, table);
    return db.prepare(`SELECT 1 FROM ${table}${indexed ? ` INDEXED BY ${table}_fact_legacy` : ''}
      WHERE event_kind = 'fact' AND NOT json_valid(event_detail) LIMIT 1`).get();
  });
  if (legacy) {
    let history = 'event';
    if (tables.includes('event_archive')) {
      history = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'event_history'").get()
        ? 'event_history' : '(SELECT * FROM event UNION ALL SELECT * FROM event_archive)';
    }
    return Boolean(db.prepare(`SELECT 1 FROM ${history} WHERE event_kind = 'fact' AND json_extract(event_detail, '$.id') = ?`).get(id));
  }
  return tables.some((table) => Boolean(db.prepare(`SELECT 1 FROM ${table}
    WHERE event_kind = 'fact' AND json_valid(event_detail) AND json_extract(event_detail, '$.id') = ?`).get(id)));
}
