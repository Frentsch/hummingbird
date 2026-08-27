import Database from 'better-sqlite3';

export type SqliteDb = InstanceType<typeof Database>;

export interface EventCursorRow {
  packageId: string;
  cursor: string;
}

export interface EventCursorFilter {
  packageId: string;
  cursor: string;
}

export function ensureEventCursorSchema(db: SqliteDb) {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_cursor (
      package_id     TEXT PRIMARY KEY,
      cursor         TEXT NOT NULL
    );
  `);
}

export function insertEventCursor(
  db: SqliteDb,
  row: EventCursorRow,
): void {
  db.prepare(`
    INSERT INTO event_cursor (package_id, cursor)
    VALUES (?, ?)
    ON CONFLICT(package_id) DO UPDATE SET cursor = excluded.cursor
  `).run(
    row.packageId,
    row.cursor,
  );
}

interface RawRow {
  package_id: string;
  cursor: string;
}

export function queryEventCursor(
  db: SqliteDb,
  filter: EventCursorFilter,
): EventCursorRow[] {
  const stmt = db.prepare<unknown[], RawRow>(`SELECT * FROM event_cursor WHERE package_id = ?`);
  stmt.safeIntegers(true);

  return stmt.all(filter.packageId).map((r: RawRow) => ({
    packageId:  r.package_id,
    cursor:     r.cursor,
  }));
}
