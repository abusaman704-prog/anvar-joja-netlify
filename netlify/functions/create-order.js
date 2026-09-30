const { getDb, admin } = require("./_lib/firebase-admin");
const { sendToStaff } = require("./_lib/telegram");
const { buildOrderText, buildButtons } = require("./_lib/order-message");
const { phoneKey, tashkentToday } = require("./_lib/util");

const IK_PREFIX = "https://ik.imagekit.io/";
const MAX_ITEM_QTY = 50;
const ID_RE = /^[A-Za-z0-9]{1,40}$/;

function fail(msg, statusCode = 400) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: msg }) };
}
function clean(s, max) {
  return String(s ?? "").trim().slice(0, max);
}

async function getKgPrice(db) {
  const snap = await db.collection("menu").where("priceType", "==", "kg").limit(5).get();
  const item = snap.docs.map((d) => d.data()).find((m) => m.category === "joja" && m.visible !== false);
  return item ? item.price : 100000;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return fail("Faqat POST", 405);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return fail("Noto'g'ri so'rov"); }

  const type = body.type;
  if (!["pickup", "delivery", "table", "bulk"].includes(type)) return fail("Buyurtma turi noto'g'ri");

  const name = clean(body.customer?.name, 60);
  const phone = clean(body.customer?.phone, 20);
  const key = phoneKey(phone);
  if (!name || key.length < 9) return fail("Ism va telefon raqamini to'g'ri kiriting");
  const address = clean(body.customer?.address, 200);
  const comment = clean(body.customer?.comment, 300);

  const needsAddress = type === "delivery" || (type === "bulk" && body.bulk?.type === "delivery");
  if (needsAddress && !address) return fail("Yetkazib berish uchun manzilni kiriting");

  try {
    const db = getDb();

    /* ---- Narxlarni serverda qayta hisoblash (mijoz yuborgan narxga ishonilmaydi) ---- */
    let items = [];
    let subtotal = 0;
    let bulk = null;

    if (type === "bulk") {
      const kg = Number(body.bulk?.kg);
      const date = clean(body.bulk?.date, 10);
      if (!(kg > 5) || kg > 500) return fail("Katta buyurtma 5 kg dan ortiq bo'lishi kerak");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= tashkentToday()) {
        return fail("Sana ertangi kundan boshlanishi kerak");
      }
      const kgPrice = await getKgPrice(db);
      subtotal = Math.round(kg * kgPrice);
      bulk = { kg, date, type: body.bulk?.type === "delivery" ? "delivery" : "pickup" };
    } else {
      const raw = Array.isArray(body.items) ? body.items : [];
      if (raw.length === 0 || raw.length > 40) return fail("Savat bo'sh");
      if (raw.some((r) => !ID_RE.test(String(r.itemId)))) return fail("Savatda noto'g'ri taom bor");

      const ids = [...new Set(raw.map((r) => String(r.itemId)))];
      const snaps = await Promise.all(ids.map((id) => db.collection("menu").doc(id).get()));
      const menuMap = {};
      snaps.forEach((s) => { if (s.exists) menuMap[s.id] = s.data(); });

      for (const r of raw) {
        const m = menuMap[String(r.itemId)];
        const qty = Number(r.qty);
        if (!m || m.visible === false) return fail("Savatdagi taomlardan biri hozir mavjud emas. Savatni yangilang.");
        if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) return fail("Miqdor noto'g'ri");
        const lineTotal = m.price * qty;
        items.push({ itemId: String(r.itemId), name: m.name, qty, unitLabel: m.unitLabel || "", price: m.price, lineTotal });
        subtotal += lineTotal;
      }
    }

    /* ---- Stol raqami ---- */
    let tableNumber = null;
    if (type === "table") {
      tableNumber = parseInt(body.tableNumber, 10);
      if (!(tableNumber >= 1 && tableNumber <= 99)) return fail("Stol raqami noto'g'ri");
    }

    /* ---- To'lov ---- */
    let payment;
    if (type === "table") {
      payment = { method: "joyida", status: "kutilmoqda_joyida" };
    } else {
      const receiptUrl = clean(body.payment?.receiptUrl, 500);
      const amountEntered = Number(body.payment?.amountEntered);
      if (!receiptUrl.startsWith(IK_PREFIX)) return fail("Chek rasmi yuklanmagan");
      if (!(amountEntered > 0) || amountEntered > 100000000) return fail("To'langan summani to'g'ri kiriting");
      payment = { method: "card", receiptUrl, amountEntered, status: "pul_tekshirilmoqda" };
      if (type === "bulk") {
        payment.advancePercent = 50;
        payment.advanceRequired = Math.round(subtotal * 0.5);
      }
    }

    /* ---- Taklif kodi (do'st telefoni) ---- */
    const refKey = phoneKey(body.referralPhone || "");
    const referredByKey = refKey.length === 9 && refKey !== key && type !== "bulk" ? refKey : "";

    /* ---- Tranzaksiya: ketma-ket kod + chegirmani band qilish + buyurtmani yozish ---- */
    const dayKey = tashkentToday().replace(/-/g, "").slice(2); // YYMMDD
    const counterRef = db.collection("counters").doc(dayKey);
    const orderRef = db.collection("orders").doc();
    const creditQuery = db.collection("referral_credits").where("phone", "==", key).where("used", "==", false).limit(1);
    let saved;

    await db.runTransaction(async (t) => {
      const counterSnap = await t.get(counterRef);
      let creditDoc = null;
      if (type !== "bulk") {
        const cs = await t.get(creditQuery);
        if (!cs.empty) creditDoc = cs.docs[0];
      }

      const n = (counterSnap.exists ? counterSnap.data().n : 0) + 1;
      const code = `AJ-${dayKey}-${String(n).padStart(3, "0")}`;
      const discountPercent = creditDoc ? creditDoc.data().percent || 5 : 0;
      const discountAmount = Math.round((subtotal * discountPercent) / 100);
      const total = subtotal - discountAmount;

      const order = {
        code,
        type,
        tableNumber,
        items,
        bulk,
        subtotal,
        discountPercent,
        discountAmount,
        total,
        customer: { name, phone, phoneKey: key, address, comment },
        referredByKey,
        payment,
        status: type === "table" ? "yangi" : "pul_tekshirilmoqda",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      t.set(counterRef, { n });
      t.set(orderRef, order);
      if (creditDoc) t.update(creditDoc.ref, { used: true, appliedToOrderCode: code });
      saved = order;
    });

    // Telegram xabarnomasi: xato bo'lsa ham buyurtma saqlangan bo'ladi
    try {
      await sendToStaff(buildOrderText(saved), buildButtons(orderRef.id, saved));
    } catch (e) {
      console.error("Telegram xabarnomasi yuborilmadi:", e);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, code: saved.code, total: saved.total }),
    };
  } catch (err) {
    console.error(err);
    return fail("Server xatosi. Qaytadan urinib ko'ring.", 500);
  }
};
