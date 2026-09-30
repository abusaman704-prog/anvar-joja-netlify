// Umumiy yordamchi funksiyalar

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Telefon raqamini solishtirish uchun kalit: faqat raqamlar, oxirgi 9 tasi
// ("+998 90 123 45 67" va "901234567" bir xil kalit beradi)
function phoneKey(p) {
  return String(p || "").replace(/\D/g, "").slice(-9);
}

function fmtSom(n) {
  return Number(n || 0).toLocaleString("uz-UZ") + " so'm";
}

// Toshkent vaqti bo'yicha bugungi sana (YYYY-MM-DD), UTC+5
function tashkentToday() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// TELEGRAM_CHAT_ID vergul bilan ajratilgan bir nechta chat bo'lishi mumkin
function staffChatIds() {
  return (process.env.TELEGRAM_CHAT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function siteUrl() {
  return (process.env.SITE_URL || process.env.URL || "").replace(/\/$/, "");
}

module.exports = { esc, phoneKey, fmtSom, tashkentToday, staffChatIds, siteUrl };
