import Database from "better-sqlite3";
import { ensureReservationSchema, type SqliteDb } from "./reservations.js";
import { ensureEventCursorSchema } from "./eventCursor.js";

export function openDB(path: string): SqliteDb{
    const db = new Database(path)
    ensureReservationSchema(db)
    ensureEventCursorSchema(db)
    return db
}