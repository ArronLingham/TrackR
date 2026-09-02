import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../userData.db');

let dbInstance = null;

export async function getDb() {
  if (dbInstance) return dbInstance;

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY,
      major TEXT,
      past_courses TEXT,
      planned_courses TEXT,
      coops TEXT
    )
  `);

  // Initialize with an empty row if it doesn't exist (id = 1)
  const row = await dbInstance.get('SELECT * FROM user_profile WHERE id = 1');
  if (!row) {
    await dbInstance.run('INSERT INTO user_profile (id, major, past_courses, planned_courses, coops) VALUES (1, "", "", "", "")');
  }

  return dbInstance;
}

export async function getProfile() {
  const db = await getDb();
  return await db.get('SELECT * FROM user_profile WHERE id = 1');
}

export async function updateProfile(data) {
  const db = await getDb();
  const { major = "", past_courses = "", planned_courses = "", coops = "" } = data;
  await db.run(
    'UPDATE user_profile SET major = ?, past_courses = ?, planned_courses = ?, coops = ? WHERE id = 1',
    [major, past_courses, planned_courses, coops]
  );
}
