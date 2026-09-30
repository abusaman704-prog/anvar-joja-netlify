const { staffChatIds } = require("./util");

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function callTelegram(method, payload) {
  return fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendTelegramMessage(chatId, text, replyMarkup) {
  const res = await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
  if (!res.ok) throw new Error("Telegram xabar yuborishda xato: " + (await res.text()));
  return res.json();
}

// Barcha xodim chatlariga yuboradi (TELEGRAM_CHAT_ID vergul bilan bir nechta bo'lishi mumkin)
async function sendToStaff(text, replyMarkup) {
  const ids = staffChatIds();
  const results = await Promise.allSettled(ids.map((id) => sendTelegramMessage(id, text, replyMarkup)));
  results.forEach((r) => { if (r.status === "rejected") console.error(r.reason); });
  return results.some((r) => r.status === "fulfilled");
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup) {
  const res = await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
  return res.json();
}

async function answerCallbackQuery(callbackQueryId, text) {
  await callTelegram("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text || "" });
}

module.exports = { sendTelegramMessage, sendToStaff, editTelegramMessage, answerCallbackQuery };
