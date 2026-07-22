import Database from 'better-sqlite3';

export type SqliteDb = InstanceType<typeof Database>;

export interface ReservationRow {
  key: number;
  resId: number;
  ia: bigint;
  ingressId: number;
  egressId: number;
  bw: number;
  startsAt: Date;
  stopsAt: Date;
  ak: string;
}

export interface ReservationFilter {
  ia?: bigint;
  ingressId?: number;
  egressId?: number;
  bw?: number;
  startsAt?: Date;
  stopsAt?: Date;
}

export function openReservationDb(path: string): SqliteDb {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      key        INTEGER PRIMARY KEY AUTOINCREMENT,
      res_id     INTEGER NOT NULL,
      ia         INTEGER NOT NULL,
      ingress_id INTEGER NOT NULL,
      egress_id  INTEGER NOT NULL,
      bw         INTEGER NOT NULL,
      starts_at  INTEGER NOT NULL,
      stops_at   INTEGER NOT NULL,
      ak         TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_res_id  ON reservations(res_id);
    CREATE INDEX IF NOT EXISTS idx_ia      ON reservations(ia);
    CREATE INDEX IF NOT EXISTS idx_ingress ON reservations(ingress_id);
    CREATE INDEX IF NOT EXISTS idx_egress  ON reservations(egress_id);
  `);
  return db;
}

export function insertReservation(
  db: SqliteDb,
  row: Omit<ReservationRow, 'key'>,
): void {
  db.prepare(`
    INSERT INTO reservations (res_id, ia, ingress_id, egress_id, bw, starts_at, stops_at, ak)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.resId,
    row.ia,
    row.ingressId,
    row.egressId,
    row.bw,
    row.startsAt.getTime(),
    row.stopsAt.getTime(),
    row.ak,
  );
}

interface RawRow {
  key: number;
  res_id: number;
  ia: bigint;
  ingress_id: number;
  egress_id: number;
  bw: number;
  starts_at: number;
  stops_at: number;
  ak: string;
}

export function queryReservations(
  db: SqliteDb,
  filter: ReservationFilter,
): ReservationRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.ia !== undefined)        { conditions.push('ia = ?');         params.push(filter.ia); }
  if (filter.ingressId !== undefined) { conditions.push('ingress_id = ?'); params.push(filter.ingressId); }
  if (filter.egressId !== undefined)  { conditions.push('egress_id = ?');  params.push(filter.egressId); }
  if (filter.bw !== undefined)        { conditions.push('bw = ?');         params.push(filter.bw); }
  if (filter.startsAt !== undefined)  { conditions.push('starts_at = ?');  params.push(filter.startsAt.getTime()); }
  if (filter.stopsAt !== undefined)   { conditions.push('stops_at = ?');   params.push(filter.stopsAt.getTime()); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = db.prepare<unknown[], RawRow>(`SELECT * FROM reservations ${where}`);
  stmt.safeIntegers(true);

  return stmt.all(...params).map((r: RawRow) => ({
    key:       Number(r.key),
    resId:     Number(r.res_id),
    ia:        r.ia,
    ingressId: Number(r.ingress_id),
    egressId:  Number(r.egress_id),
    bw:        Number(r.bw),
    startsAt:  new Date(Number(r.starts_at)),
    stopsAt:   new Date(Number(r.stops_at)),
    ak:        r.ak,
  }));
}
