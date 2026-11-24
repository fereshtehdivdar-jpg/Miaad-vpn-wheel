require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { db, getOrCreateUser } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "miaad_vpn";
const WEBAPP_URL = process.env.WEBAPP_URL || "https://your-app.onrender.com";
const INSTAGRAM_URL = process.env.INSTAGRAM_URL || "https://instagram.com/miaad.vpn";
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "0");

const bot = new Telegraf(BOT_TOKEN);

async function isChannelMember(userId) {
  try {
    const res = await bot.telegram.getChatMember("@" + CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(res.status);
  } catch (e) { return false; }
}

bot.start(async (ctx) => {
  const payload = ctx.startPayload || null;
  const userId = ctx.from.id;

  if (!(await isChannelMember(userId))) {
    return ctx.reply("برای شرکت در گردونه شانس، ابتدا باید عضو کانال بشی 👇",
      Markup.inlineKeyboard([
        [Markup.button.url("📢 عضویت در کانال", `https://t.me/${CHANNEL_USERNAME}`)],
        [Markup.button.callback("✅ عضو شدم", "check_join")]
      ]));
  }

  getOrCreateUser(userId, ctx.from.username, ctx.from.first_name, payload, async (err, { user }) => {
    if (err) return ctx.reply("خطا در ثبت‌نام");
    const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${user.invite_code}`;
    const buttons = [];
    if (user.spins_available > 0) {
      buttons.push([Markup.button.webApp("🎡 چرخوندن گردونه", `${WEBAPP_URL}/?uid=${userId}`)]);
    }
    buttons.push([Markup.button.url("📸 اینستاگرام میعاد", INSTAGRAM_URL)]);
    buttons.push([Markup.button.callback("🔄 بروزرسانی", "refresh")]);

    await ctx.reply(`👋 سلام ${ctx.from.first_name}!\n\n🎟 شانس‌های باقی‌مانده: ${user.spins_available}\n👥 تعداد دعوت‌ها: ${user.total_invites}\n\n🔗 لینک دعوت اختصاصی تو:\n${inviteLink}`, Markup.inlineKeyboard(buttons));
  });
});

bot.action("check_join", async (ctx) => {
  if (!(await isChannelMember(ctx.from.id))) return ctx.answerCbQuery("❌ هنوز عضو نشدی!", { show_alert: true });
  await ctx.answerCbQuery("✅ عضویت تأیید شد");
  getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name, null, async (err, { user }) => {
    await ctx.editMessageText(`✅ عضویتت تأیید شد!\n\n🎟 شانس: ${user.spins_available}`, Markup.inlineKeyboard([Markup.button.callback("🔄 بروزرسانی", "refresh")]));
  });
});

bot.action("refresh", async (ctx) => {
  db.get("SELECT * FROM users WHERE telegram_id = ?", [ctx.from.id], async (err, user) => {
    if (!user) return ctx.answerCbQuery("ابتدا /start را بزنید");
    const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${user.invite_code}`;
    await ctx.editMessageText(`🎟 شانس‌ها: ${user.spins_available}\n👥 دعوت‌ها: ${user.total_invites}\n\n🔗 لینک دعوت:\n${inviteLink}`,
      Markup.inlineKeyboard([
        user.spins_available > 0 ? [Markup.button.webApp("🎡 چرخوندن گردونه", `${WEBAPP_URL}/?uid=${ctx.from.id}`)] : [],
        [Markup.button.callback("🔄 بروزرسانی", "refresh")]
      ].filter(r => r.length)));
  });
});

bot.command("stats", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  db.get("SELECT COUNT(*) as c FROM users", [], (err, u) => {
    db.get("SELECT COUNT(*) as c FROM wins", [], (err, w) => {
      ctx.reply(`📊 کاربران: ${u.c}\n🏆 برنده‌ها: ${w.c}`);
    });
  });
});

bot.catch((err) => console.error("Bot error:", err));
console.log("🤖 ربات روشن شد");
bot.launch();
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
