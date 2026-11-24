require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { db, generateDiscountCode, pickRandomPrize } = require("./db");

require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/info/:uid", (req, res) => {
  const uid = parseInt(req.params.uid);
  db.get("SELECT * FROM users WHERE telegram_id = ?", [uid], (err, user) => {
    if (!user) return res.status(404).json({ error: "کاربر یافت نشد" });
    db.all("SELECT wheel_index, label, full_price, discount_price, discount_percent, remaining, is_jackpot FROM prizes ORDER BY wheel_index", [], (err, prizes) => {
      res.json({ spins: user.spins_available, prizes });
    });
  });
});

app.post("/api/prepare-spin", (req, res) => {
  const { uid } = req.body;
  db.get("SELECT * FROM users WHERE telegram_id = ?", [uid], (err, user) => {
    if (!user) return res.status(404).json({ error: "کاربر یافت نشد" });
    if (user.spins_available <= 0) return res.status(400).json({ error: "شما شانسی ندارید" });

    const token = crypto.randomBytes(16).toString("hex");
    db.run("INSERT OR REPLACE INTO pending_spins (user_id, token) VALUES (?, ?)", [uid, token], (err) => {
      res.json({ token });
    });
  });
});

app.post("/api/spin", (req, res) => {
  const { token } = req.body;
  db.get("SELECT * FROM pending_spins WHERE token = ?", [token], (err, row) => {
    if (!row) return res.status(400).json({ error: "توکن نامعتبر" });

    const uid = row.user_id;
    db.run("DELETE FROM pending_spins WHERE token = ?", [token]);

    db.get("SELECT * FROM users WHERE telegram_id = ?", [uid], (err, user) => {
      if (!user || user.spins_available <= 0) return res.status(400).json({ error: "شانس کافی ندارید" });

      pickRandomPrize((err, prize) => {
        if (!prize) return res.status(500).json({ error: "خطا" });

        db.run("INSERT INTO spin_log (user_id, result_index, result_type) VALUES (?, ?, ?)", [uid, prize.wheel_index, prize.total_count === 0 ? "empty" : "prize"]);

        const isRetry = prize.label.includes("شانس دوباره");
        if (!isRetry) {
          db.run("UPDATE users SET spins_available = spins_available - 1, spins_used = spins_used + 1 WHERE telegram_id = ?", [uid]);
        }

        if (prize.total_count > 0 && prize.discount_price >= 0) {
          db.run("UPDATE prizes SET remaining = remaining - 1 WHERE id = ?", [prize.id]);
          generateDiscountCode((code) => {
            db.run("INSERT INTO wins (user_id, prize_id, discount_code) VALUES (?, ?, ?)", [uid, prize.id, code], () => {
              res.json({
                index: prize.wheel_index, label: prize.label, full_price: prize.full_price,
                discount_price: prize.discount_price, discount_percent: prize.discount_percent,
                is_retry: isRetry, win: { code }
              });
            });
          });
        } else {
          res.json({
            index: prize.wheel_index, label: prize.label, full_price: prize.full_price,
            discount_price: prize.discount_price, discount_percent: prize.discount_percent,
            is_retry: isRetry, win: null
          });
        }
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`🌐 وب‌سرور روی پورت ${PORT} روشن شد`);
});
