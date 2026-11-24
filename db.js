const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.join(__dirname, "wheel.db"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    invite_code TEXT UNIQUE NOT NULL,
    invited_by INTEGER,
    spins_available INTEGER DEFAULT 0,
    spins_used INTEGER DEFAULT 0,
    total_invites INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wheel_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    full_price INTEGER DEFAULT 0,
    discount_price INTEGER DEFAULT 0,
    discount_percent INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    remaining INTEGER DEFAULT 0,
    is_jackpot INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prize_id INTEGER NOT NULL,
    discount_code TEXT UNIQUE NOT NULL,
    claimed INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS spin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    result_index INTEGER NOT NULL,
    result_type TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pending_spins (
    user_id INTEGER PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`, () => {
    seedPrizes();
  });
});

function seedPrizes() {
  db.get("SELECT COUNT(*) as c FROM prizes", (err, row) => {
    if (row && row.c > 0) return;

    const prizes = [
      { index: 0, label: "تک‌کاربره نامحدود|۱۹۹ تومان", full: 365, disc: 199, pct: 45, count: 10, jackpot: 0 },
      { index: 1, label: "پوچ", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
      { index: 2, label: "دوکاربره نامحدود|۲۹۹ تومان", full: 475, disc: 299, pct: 37, count: 10, jackpot: 0 },
      { index: 3, label: "شانس دوباره 🔄", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
      { index: 4, label: "۵۰ گیگ ۱ماهه|۱۲۹ تومان", full: 190, disc: 129, pct: 32, count: 10, jackpot: 0 },
      { index: 5, label: "🎁 ۱۰۰٪ تخفیف|۱۰ گیگ رایگان", full: 89, disc: 0, pct: 100, count: 5, jackpot: 1 },
      { index: 6, label: "۳۰ گیگ ۱ماهه|۷۰ تومان", full: 125, disc: 70, pct: 44, count: 10, jackpot: 0 },
      { index: 7, label: "پوچ", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 },
      { index: 8, label: "پوچ", full: 0, disc: 0, pct: 0, count: 0, jackpot: 0 }
    ];

    const stmt = db.prepare(`INSERT INTO prizes (wheel_index, label, full_price, discount_price, discount_percent, total_count, remaining, is_jackpot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of prizes) {
      stmt.run(p.index, p.label, p.full, p.disc, p.pct, p.count, p.count, p.jackpot);
    }
    stmt.finalize();
    console.log("✅ جوایز مقداردهی اولیه شد");
  });
}

function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getOrCreateUser(telegramId, username, firstName, invitedByCode, callback) {
  db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
    if (user) {
      // کاربر از قبل هست، فقط بروزرسانی نام
      db.run("UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?", [username, firstName, telegramId]);
      return callback(null, { user, isNew: false });
    }

    // کاربر جدیده
    let inviterId = null;
    const proceed = (code) => {
      if (invitedByCode) {
        db.get("SELECT * FROM users WHERE invite_code = ?", [invitedByCode], (err, inviter) => {
          if (inviter && inviter.telegram_id !== telegramId) {
            inviterId = inviter.telegram_id;
          }
          insertUser(code, inviterId);
        });
      } else {
        insertUser(code, null);
      }
    };

    const insertUser = (code, inviter) => {
      db.run(`INSERT INTO users (telegram_id, username, first_name, invite_code, invited_by) VALUES (?, ?, ?, ?, ?)`,
        [telegramId, username, firstName, code, inviter], (err) => {
          if (err) return callback(err);
          
          if (inviter) {
            db.run("UPDATE users SET spins_available = spins_available + 1, total_invites = total_invites + 1 WHERE telegram_id = ?", [inviter]);
          }

          db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, newUser) => {
            callback(err, { user: newUser, isNew: true, invitedBy: inviter });
          });
        });
    };

    // چک کردن اینکه کد تکراری نباشه
    const newCode = generateInviteCode();
    db.get("SELECT 1 FROM users WHERE invite_code = ?", [newCode], (err, exists) => {
      if (exists) return proceed(generateInviteCode()); // اگه تکراری بود دوباره بساز
      proceed(newCode);
    });
  });
}

function generateDiscountCode(callback) {
  const code = `MIAAD-${generateInviteCode()}`;
  callback(code);
}

function pickRandomPrize(callback) {
  db.all("SELECT * FROM prizes", [], (err, prizes) => {
    if (err) return callback(err);
    const eligible = prizes.filter(p => p.total_count === 0 || p.remaining > 0);
    if (eligible.length === 0) {
      const empty = prizes.find(p => p.total_count === 0);
      return callback(null, empty);
    }
    const pick = eligible[Math.floor(Math.random() * eligible.length)];
    callback(null, pick);
  });
}

module.exports = { db, getOrCreateUser, generateDiscountCode, pickRandomPrize };
