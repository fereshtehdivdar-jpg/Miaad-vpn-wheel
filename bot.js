const { Telegraf, Markup } = require("telegraf");
const crypto = require("crypto");
const {
  db,
  getOrCreateUser,
  createPendingSpin,
} = require("./db");

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL = "@" + process.env.CHANNEL_USERNAME;

// بررسی عضویت در کانال
async function isChannelMember(userId) {
  try {
    const member = await bot.telegram.getChatMember(CHANNEL, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) {
    console.error("خطا در بررسی عضویت:", e.message);
    return false;
  }
}

// صفحه اصلی
async function showMainMenu(ctx) {
  const userId = ctx.from.id;
  const isMember = await isChannelMember(userId);

  if (!isMember) {
    return ctx.reply(
      "برای استفاده از گردونه شانس، اول باید عضو کانال ما بشی:",
      Markup.inlineKeyboard([
        [Markup.button.url("📢 عضویت در کانال", "https://t.me/" + process.env.CHANNEL_USERNAME)],
        [Markup.button.callback("✅ عضو شدم، بررسی کن", "check_membership")],
      ])
    );
  }

  const { user } = getOrCreateUser(
    userId,
    ctx.from.username,
    ctx.from.first_name,
    ctx.startPayload || null
  );

  const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${user.invite_code}`;
  const canSpin = user.spins_available > 0 && user.spins_used < 10;

  let text = `🎡 *گردونه شانس میعاد VPN*\n\n`;
  text += `👤 کد دعوت شما: \`${user.invite_code}\`\n`;
  text += `🎟 شانس‌های باقی‌مانده: *${user.spins_available}*\n`;
  text += `👥 تعداد دعوت‌ها: *${user.total_invites}*\n\n`;
  text += `🔗 *لینک دعوت شما:*\n\`${inviteLink}\`\n\n`;
  text += `هر دعوت موفق = ۱ شانس اضافه 🎁`;

  const buttons = [];
  if (canSpin) {
    buttons.push([Markup.button.callback("🎰 چرخوندن گردونه", "spin")]);
  } else if (user.spins_used >= 10) {
    buttons.push([Markup.button.callback("⛔ به سقف ۱۰ شانس رسیدی", "noop")]);
  } else {
    buttons.push([Markup.button.callback("📭 شانس نداری، دوستات رو دعوت کن", "noop")]);
  }
  buttons.push([Markup.button.callback("📊 آمار من", "my_stats")]);
  buttons.push([Markup.button.url("📸 اینستاگرام ما", process.env.INSTAGRAM_URL)]);

  ctx.reply(text, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

// دستور start
bot.start(async (ctx) => {
  const payload = ctx.startPayload;
  if (payload) {
    const inviter = db.prepare("SELECT * FROM users WHERE invite_code = ?").get(payload);
    if (inviter && inviter.telegram_id === ctx.from.id) {
      await ctx.reply("نمی‌تونی خودت رو دعوت کنی 😄");
    }
  }
  await showMainMenu(ctx);
});

// بررسی عضویت
bot.action("check_membership", async (ctx) => {
  await ctx.answerCbQuery();
  const isMember = await isChannelMember(ctx.from.id);
  if (!isMember) {
    return ctx.reply("❌ هنوز عضو کانال نشدی. اول عضو شو بعد دوباره امتحان کن.");
  }
  await ctx.deleteMessage().catch(() => {});
  await showMainMenu(ctx);
});

// چرخوندن گردونه
bot.action("spin", async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;

  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(userId);
  if (!user) return ctx.reply("اول /start رو بزن.");
  if (user.spins_used >= 10) return ctx.reply("⛔ به سقف ۱۰ شانس رسیدی.");
  if (user.spins_available < 1) return ctx.reply("📭 شانسی نداری. دوستات رو دعوت کن!");

  const isMember = await isChannelMember(userId);
  if (!isMember) return ctx.reply("❌ اول عضو کانال شو.");

  // ساخت token یکبارمصرف
  const token = crypto.randomBytes(16).toString("hex");
  createPendingSpin(userId, token);

  const webUrl = `${process.env.WEBAPP_URL}?token=${token}`;

  await ctx.reply(
    "🎰 برای چرخوندن گردونه روی دکمه زیر بزن:",
    Markup.inlineKeyboard([
      [Markup.button.webApp("🎡 باز کردن گردونه", webUrl)],
    ])
  );
});

// آمار من
bot.action("my_stats", async (ctx) => {
  await ctx.answerCbQuery();
  const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(ctx.from.id);
  if (!user) return ctx.reply("اول /start رو بزن.");

  const wins = db.prepare(`
    SELECT w.*, p.label FROM wins w
    JOIN prizes p ON p.id = w.prize_id
    WHERE w.user_id = ? ORDER BY w.id DESC
  `).all(ctx.from.id);

  let text = `📊 *آمار شما*\n\n`;
  text += `🎟 شانس موجود: ${user.spins_available}\n`;
  text += `🎰 چرخش انجام‌شده: ${user.spins_used}/10\n`;
  text += `👥 دعوت موفق: ${user.total_invites}\n\n`;

  if (wins.length > 0) {
    text += `🏆 *جوایز شما:*\n`;
    for (const w of wins) {
      text += `\n• ${w.label}\n  کد: \`${w.discount_code}\`\n`;
    }
  } else {
    text += `هنوز جایزه‌ای نبردی.`;
  }

  ctx.reply(text, { parse_mode: "Markdown" });
});

bot.action("noop", (ctx) => ctx.answerCbQuery());

// خطاها
bot.catch((err, ctx) => {
  console.error("خطای ربات:", err);
});

module.exports = bot;
