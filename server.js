const express = require("express");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const bot = require("./bot");
const {
  db,
  generateDiscountCode,
  consumePendingSpin,
  pickRandomPrize,
} = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// بررسی اینکه کاربر هنوز عضو کانال هست یا نه
async function isChannelMember(userId) {
  try {
    const member = await bot.telegram.getChatMember(
      "@" + process.env.CHANNEL_USERNAME,
      userId
    );
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) {
    return false;
  }
}

// API: اطلاعات کاربر با توکن
app.get("/api/user", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "توکن نامعتبر" });

  const row = db.prepare("SELECT * FROM pending_spins WHERE token = ?").get(token);
  if (!row) return res.status(404).json({ error: "توکن منقضی شده یا نامعتبر" });

  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(row.user_id);
  if (!user) return res.status(404).json({ error: "کاربر یافت نشد" });

  const isMember = await isChannelMember(user.telegram_id);
  if (!isMember) return res.status(403).json({ error: "ابتدا عضو کانال شوید" });

  res.json({
    first_name: user.first_name,
    spins_available: user.spins_available,
    spins_used: user.spins_used,
    max_spins: 10,
  });
});

// API: گرفتن لیست جوایز برای رسم گردونه
app.get("/api/prizes", (req, res) => {
  const prizes = db.prepare("SELECT wheel_index, label, is_jackpot FROM prizes ORDER BY wheel_index").all();
  res.json(prizes);
});

// API: انجام چرخش
app.post("/api/spin", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "توکن نامعتبر" });

  // توکن یکبارمصرف
  const userId = consumePendingSpin(token);
  if (!userId) return res.status(400).json({ error: "این توکن قبلاً استفاده شده" });

  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "کاربر یافت نشد" });

  if (user.spins_used >= 10) return res.status(403).json({ error: "به سقف ۱۰ شانس رسیدید" });
  if (user.spins_available < 1) return res.status(403).json({ error: "شانسی ندارید" });

  const isMember = await isChannelMember(userId);
  if (!isMember) return res.status(403).json({ error: "ابتدا عضو کانال شوید" });

  // انتخاب جایزه
  const prize = pickRandomPrize();

  // ثبت در دیتابیس
  db.prepare("UPDATE users SET spins_available = spins_available - 1, spins_used = spins_used + 1 WHERE telegram_id = ?").run(userId);

  db.prepare("INSERT INTO spin_log (user_id, result_index, result_type) VALUES (?, ?, ?)").run(
    userId,
    prize.wheel_index,
    prize.total_count === 0 ? (prize.label === "شانس دوباره" ? "respin" : "empty") : "prize"
  );

  let discountCode = null;
  if (prize.total_count > 0) {
    discountCode = generateDiscountCode();
    db.prepare("INSERT INTO wins (user_id, prize_id, discount_code) VALUES (?, ?, ?)").run(userId, prize.id, discountCode);
    db.prepare("UPDATE prizes SET remaining = remaining - 1 WHERE id = ?").run(prize.id);
  }

  const updatedUser = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(userId);

  // ارسال پیام به کاربر در تلگرام
  let msg = "";
  if (prize.total_count === 0 && prize.label === "شانس دوباره") {
    msg = "🔄 شانس دوباره! یه بار دیگه می‌تونی بچرخونی.\nشانس اضافه شد.";
    db.prepare("UPDATE users SET spins_available = spins_available + 1 WHERE telegram_id = ?").run(userId);
  } else if (prize.total_count === 0) {
    msg = "😅 پوچ! دفعه بعد شانس بیار.";
  } else {
    msg = `🎉 تبریک! برنده شدی:\n${prize.label.replace("|", "\n")}\n\n🎟 کد تخفیف: \`${discountCode}\`\n\n📸 از رسید اسکرین‌شات بگیر و به ادمین بفرست.`;
  }

  bot.telegram.sendMessage(userId, msg, { parse_mode: "Markdown" }).catch(() => {});

  res.json({
    wheel_index: prize.wheel_index,
    label: prize.label,
    is_jackpot: prize.is_jackpot,
    is_empty: prize.total_count === 0 && prize.label !== "شانس دوباره",
    is_respin: prize.label === "شانس دوباره",
    discount_code: discountCode,
    full_price: prize.full_price,
    discount_price: prize.discount_price,
    discount_percent: prize.discount_percent,
    spins_available: updatedUser.spins_available,
    spins_used: updatedUser.spins_used,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ سرور روی پورت ${PORT} بالا آمد`);
});

bot.launch();
console.log("🤖 ربات تلگرام روشن شد");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
