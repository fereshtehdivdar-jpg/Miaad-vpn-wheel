const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "wheel.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    invite_code TEXT UNIQUE NOT NULL,
    invited_by INTEGER,
    spins_available INTEGER DEFAULT 0,
    spins_used INTEGER DEFAULT 0,
    total_invites INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wheel_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    full_price INTEGER DEFAULT 0,
    discount_price INTEGER DEFAULT 0,
    discount_percent INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    remaining INTEGER DEFAULT 0,
    is_jackpot INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prize_id INTEGER NOT NULL,
    discount_code TEXT UNIQUE NOT NULL,
    claimed INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS spin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    result_index INTEGER NOT NULL,
    result_type TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS pending_spins (
    user_id INTEGER PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

function seedPrizes() {
  const count = db.prepare("SELECT COUNT(*) as c FROM prizes").get().c;
  if (count > 0) return;

  const prizes = [
    { index: 0, label: "تک‌کاربره نامحدود یک‌ماهه|۱۹۹ تومان", full: 365, disc: 199, pct: 45, count: 10, jackpot: 0 },
    { index: 1, label: "پوچ", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
    { index: 2, label: "دوکاربره نامحدود یک‌ماهه|۲۹۹ تومان", full: 475, disc: 299, pct: 37, count: 10, jackpot: 0 },
    { index: 3, label: "شانس دوباره", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
    { index: 4, label: "۵۰ گیگ یک‌ماهه|۱۲۹ تومان", full: 190, disc: 129, pct: 32, count: 10, jackpot: 0 },
    { index: 5, label: "۱۰۰٪ تخفیف|۱۰ گیگ رایگان", full: 89, disc: 0, pct: 100, count: 5, jackpot: 1 },
    { index: 6, label: "۳۰ گیگ یک‌ماهه|۷۰ تومان", full: 125, disc: 70, pct: 44, count: 10, jackpot: 0 },
    { index: 7, label: "پوچ", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
    { index: 8, label: "پوچ", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
  ];

  const insert = db.prepare(`
    INSERT INTO prizes (wheel_index, label, full_price, discount_price, discount_percent, total_count, remaining, is_jackpot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of prizes) {
    insert.run(p.index, p.label, p.full, p.disc, p.pct, p.count, p.count, p.jackpot);
  }
  console.log("✅ جوایز مقداردهی اولیه شد");
}
seedPrizes();

function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code, exists = true;
  while (exists) {
    code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    exists = !!db.prepare("SELECT 1 FROM users WHERE invite_code = ?").get(code);
  }
  return code;
}

function generateDiscountCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code, exists = true;
  while (exists) {
    let part = "";
    for (let i = 0; i < 6; i++) part += chars[Math.floor(Math.random() * chars.length)];
    code = `MIAAD-${part}`;
    exists = !!db.prepare("SELECT 1 FROM wins WHERE discount_code = ?").get(code);
  }
  return code;
}

function getOrCreateUser(telegramId, username, firstName, invitedByCode = null) {
  let user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
  if (user) return { user, isNew: false };

  let invitedBy = null;
  if (invitedByCode) {
    const inviter = db.prepare("SELECT * FROM users WHERE invite_code = ?").get(invitedByCode);
    if (inviter && inviter.telegram_id !== telegramId) invitedBy = inviter.telegram_id;
  }

  const inviteCode = generateInviteCode();
  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, invite_code, invited_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(telegramId, username || null, firstName || null, inviteCode, invitedBy);

  if (invitedBy) {
    db.prepare(`
      UPDATE users SET spins_available = spins_available + 1, total_invites = total_invites + 1
      WHERE telegram_id = ?
    `).run(invitedBy);
  }

  user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
  return { user, isNew: true, invitedBy };
}

function createPendingSpin(userId, token) {
  db.prepare("INSERT OR REPLACE INTO pending_spins (user_id, token) VALUES (?, ?)").run(userId, token);
}

function consumePendingSpin(token) {
  const row = db.prepare("SELECT * FROM pending_spins WHERE token = ?").get(token);
  if (!row) return null;
  db.prepare("DELETE FROM pending_spins WHERE token = ?").run(token);
  return row.user_id;
}

function pickRandomPrize() {
  const prizes = db.prepare("SELECT * FROM prizes ORDER BY wheel_index").all();
  const available = prizes.map(p => {
    if (p.total_count === 0) return { ...p, eligible: true };
    return { ...p, eligible: p.remaining > 0 };
  });
  const eligible = available.filter(p => p.eligible);
  if (eligible.length === 0) return prizes.find(p => p.total_count === 0);
  return eligible[Math.floor(Math.random() * eligible.length)];
}

module.exports = {
  db,
  getOrCreateUser,
  generateDiscountCode,
  createPendingSpin,
  consumePendingSpin,
  pickRandomPrize,
};