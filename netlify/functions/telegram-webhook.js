const { getDb, admin } = require("./_lib/firebase-admin");
const { sendTelegramMessage, editTelegramMessage, answerCallbackQuery } = require("./_lib/telegram");
const { STATUS_LABELS, nextStatusFor, buildOrderText, buildButtons } = require("./_lib/order-message");
const { esc, fmtSom, staffChatIds, siteUrl } = require("./_lib/util");

const CATEGORY_LABELS = { joja: "Jo'ja", milliy: "Milliy taomlar", shashlik: "Shashlik" };

async function logAudit(db, actor, action, orderId) {
  try {
    await db.collection("audit_logs").add({
      actor,
      action,
      orderId: orderId || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error("Audit log xatosi:", e); }
}

async function maybeIssueReferralCredit(db, order, orderId) {
  if (!order.referredByKey) return;
  const existing = await db.collection("referral_credits").where("fromOrderId", "==", orderId).limit(1).get();
  if (!existing.empty) return;
  await db.collection("referral_credits").add({
    phone: order.referredByKey,
    percent: 5,
    used: false,
    fromOrderId: orderId,
    fromOrderCode: order.code,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/* ---------- Mijozlar uchun oddiy buyruqlar ---------- */
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const url = siteUrl();
  const cmd = text.split(/[\s@]/)[0];

  if (cmd === "/start") {
    await sendTelegramMessage(chatId,
      `<b>Anvar Joja</b>ga xush kelibsiz!\n\nIssiq qovurilgan jo'ja, milliy taomlar va shashlik.\n` +
      `Buyurtma berish: ${url ? esc(url) : "saytimizga kiring"}\n\nMenyuni ko'rish: /menu\nSizning chat ID: <code>${esc(chatId)}</code>`);
  } else if (cmd === "/menu") {
    const snap = await getDb().collection("menu").orderBy("order", "asc").get();
    const items = snap.docs.map((d) => d.data()).filter((m) => m.visible !== false);
    if (items.length === 0) {
      await sendTelegramMessage(chatId, "Menyu hozircha bo'sh.");
      return;
    }
    const byCat = {};
    items.forEach((m) => { (byCat[m.category] = byCat[m.category] || []).push(m); });
    const lines = [];
    Object.keys(byCat).forEach((cat) => {
      lines.push(`\n<b>${esc(CATEGORY_LABELS[cat] || cat)}</b>`);
      byCat[cat].forEach((m) => lines.push(`• ${esc(m.name)}: ${fmtSom(m.price)}`));
    });
    if (url) lines.push(`\nBuyurtma berish: ${esc(url)}`);
    await sendTelegramMessage(chatId, lines.join("\n").trim());
  } else if (cmd === "/id") {
    await sendTelegramMessage(chatId, `Chat ID: <code>${esc(chatId)}</code>`);
  }
}

/* ---------- Xodimlar uchun tugmalar ---------- */
async function handleCallback(cq) {
  const db = getDb();
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  if (!staffChatIds().includes(String(chatId))) {
    await answerCallbackQuery(cq.id, "Ruxsat yo'q");
    return;
  }

  const [action, orderId] = (cq.data || "").split(":");
  const orderRef = db.collection("orders").doc(String(orderId));
  let snap = await orderRef.get();
  if (!snap.exists) {
    await answerCallbackQuery(cq.id, "Buyurtma topilmadi");
    return;
  }
  let order = snap.data();
  const actor = `telegram: ${cq.from?.first_name || ""} ${cq.from?.username ? "@" + cq.from.username : ""}`.trim();
  const finished = order.status === "bekor_qilindi" || order.status === "bajarildi";
  let toast = "";

  if (finished) {
    toast = "Bu buyurtma yakunlangan";
  } else if (action === "confirm") {
    if (order.status !== "pul_tekshirilmoqda") {
      toast = "To'lov allaqachon ko'rib chiqilgan";
    } else {
      await orderRef.update({ "payment.status": "tasdiqlangan", status: "qabul_qilindi" });
      await logAudit(db, actor, "to'lov tasdiqlandi", orderId);
      toast = "To'lov tasdiqlandi";
    }
  } else if (action === "cancel") {
    await orderRef.update({ status: "bekor_qilindi", "payment.status": "bekor" });
    await logAudit(db, actor, "bekor qilindi", orderId);
    toast = "Buyurtma bekor qilindi";
  } else if (action === "next") {
    if (order.status === "pul_tekshirilmoqda") {
      toast = "Avval to'lovni tasdiqlang";
    } else {
      const next = nextStatusFor(order);
      if (next) {
        await orderRef.update({ status: next });
        await logAudit(db, actor, `holat: ${next}`, orderId);
        if (next === "bajarildi") await maybeIssueReferralCredit(db, order, orderId);
        toast = "Holat yangilandi";
      }
    }
  }

  await answerCallbackQuery(cq.id, toast);

  // Xabarni buyurtma ma'lumotidan qayta tuzamiz (chek havolasi yo'qolmasligi uchun)
  snap = await orderRef.get();
  order = snap.data();
  const text = `${buildOrderText(order)}\n\n<b>Holat: ${esc(STATUS_LABELS[order.status] || order.status)}</b>`;
  await editTelegramMessage(chatId, messageId, text, buildButtons(orderId, order));
}

exports.handler = async function (event) {
  // Maxfiy kalit MAJBURIY: usiz soxta so'rovlar orqali to'lovlarni tasdiqlash mumkin bo'lardi
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.error("TELEGRAM_WEBHOOK_SECRET o'rnatilmagan");
    return { statusCode: 500, body: "Sozlanmagan" };
  }
  const headerSecret = event.headers["x-telegram-bot-api-secret-token"];
  if (headerSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return { statusCode: 401, body: "Ruxsat yo'q" };
  }

  try {
    const update = JSON.parse(event.body || "{}");
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message && update.message.text) await handleMessage(update.message);
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: "xato qayd etildi" }; // Telegram qayta-qayta yubormasligi uchun 200
  }
};
