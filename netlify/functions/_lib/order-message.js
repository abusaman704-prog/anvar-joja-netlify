const { esc, fmtSom } = require("./util");

const STATUS_LABELS = {
  yangi: "Yangi",
  pul_tekshirilmoqda: "To'lov tekshirilmoqda",
  qabul_qilindi: "Qabul qilindi",
  tayyorlanmoqda: "Tayyorlanmoqda",
  tayyor: "Tayyor",
  yetkazilmoqda: "Yetkazilmoqda",
  bajarildi: "Bajarildi",
  bekor_qilindi: "Bekor qilindi",
};

function isDeliveryOrder(order) {
  return order.type === "delivery" || (order.type === "bulk" && order.bulk?.type === "delivery");
}

function nextStatusFor(order) {
  let flow;
  if (order.type === "table") {
    flow = ["yangi", "qabul_qilindi", "tayyorlanmoqda", "tayyor", "bajarildi"];
  } else if (isDeliveryOrder(order)) {
    flow = ["pul_tekshirilmoqda", "qabul_qilindi", "tayyorlanmoqda", "tayyor", "yetkazilmoqda", "bajarildi"];
  } else {
    flow = ["pul_tekshirilmoqda", "qabul_qilindi", "tayyorlanmoqda", "tayyor", "bajarildi"];
  }
  const idx = flow.indexOf(order.status);
  return idx >= 0 ? flow[idx + 1] || null : null;
}

// Foydalanuvchi kiritgan barcha matnlar esc() bilan tozalanadi (Telegram HTML rejimi uchun)
function buildOrderText(order) {
  const lines = [];
  lines.push(`<b>Buyurtma ${esc(order.code)}</b>`);

  if (order.type === "bulk") {
    lines.push(`Turi: katta buyurtma (${order.bulk?.type === "delivery" ? "yetkazish" : "olib ketish"})`);
    lines.push(`Miqdor: ${esc(order.bulk?.kg)} kg jo'ja, sana: ${esc(order.bulk?.date)}`);
    lines.push(`Jami narx: ${fmtSom(order.total)}`);
    lines.push(`Avans (50%): ${fmtSom(order.payment?.advanceRequired)} kerak, mijoz ${fmtSom(order.payment?.amountEntered)} yozdi`);
  } else if (order.type === "table") {
    lines.push(`Turi: stol buyurtmasi, ${esc(order.tableNumber)}-stol`);
    lines.push("");
    (order.items || []).forEach((i) => lines.push(`• ${esc(i.name)} x${esc(i.qty)}: ${fmtSom(i.lineTotal)}`));
    lines.push("");
    if (order.discountAmount) lines.push(`Chegirma: -${fmtSom(order.discountAmount)} (${esc(order.discountPercent)}%)`);
    lines.push(`Jami: ${fmtSom(order.total)}`);
    lines.push("To'lov: stolda (naqd yoki karta)");
  } else {
    lines.push(`Turi: ${order.type === "pickup" ? "olib ketish" : "yetkazib berish"}`);
    lines.push("");
    (order.items || []).forEach((i) => lines.push(`• ${esc(i.name)} x${esc(i.qty)}: ${fmtSom(i.lineTotal)}`));
    lines.push("");
    if (order.discountAmount) lines.push(`Chegirma: -${fmtSom(order.discountAmount)} (${esc(order.discountPercent)}%)`);
    lines.push(`Jami: ${fmtSom(order.total)}`);
    lines.push(`Mijoz yozgan summa: ${fmtSom(order.payment?.amountEntered)}`);
  }

  lines.push("");
  lines.push(`Mijoz: ${esc(order.customer?.name)}`);
  lines.push(`Tel: ${esc(order.customer?.phone)}`);
  if (order.customer?.address) lines.push(`Manzil: ${esc(order.customer.address)}`);
  if (order.customer?.comment) lines.push(`Izoh: ${esc(order.customer.comment)}`);
  if (order.payment?.receiptUrl) lines.push(`\n<a href="${esc(order.payment.receiptUrl)}">Chekni ko'rish</a>`);

  return lines.join("\n");
}

function buildButtons(orderId, order) {
  if (order.status === "bekor_qilindi" || order.status === "bajarildi") return undefined;

  if (order.status === "pul_tekshirilmoqda") {
    return {
      inline_keyboard: [[
        { text: "To'lovni tasdiqlash", callback_data: `confirm:${orderId}` },
        { text: "Bekor qilish", callback_data: `cancel:${orderId}` },
      ]],
    };
  }
  const next = nextStatusFor(order);
  const row = [];
  if (next) row.push({ text: STATUS_LABELS[next], callback_data: `next:${orderId}` });
  row.push({ text: "Bekor qilish", callback_data: `cancel:${orderId}` });
  return { inline_keyboard: [row] };
}

module.exports = { STATUS_LABELS, nextStatusFor, buildOrderText, buildButtons };
