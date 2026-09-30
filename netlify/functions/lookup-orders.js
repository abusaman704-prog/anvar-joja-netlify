const { getDb } = require("./_lib/firebase-admin");
const { phoneKey } = require("./_lib/util");

// Telefon bo'yicha buyurtma tarixi. Faqat xavfsiz maydonlar qaytariladi:
// manzil, izoh va chek havolasi HECH QACHON qaytarilmaydi.
exports.handler = async function (event) {
  const respond = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  if (event.httpMethod !== "POST") return respond(405, { error: "Faqat POST" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return respond(400, { error: "Noto'g'ri so'rov" }); }

  const key = phoneKey(body.phone);
  if (key.length < 9) return respond(400, { error: "Telefon raqamini to'liq kiriting" });

  try {
    const snap = await getDb().collection("orders").where("customer.phoneKey", "==", key).limit(200).get();
    const orders = snap.docs
      .map((d) => {
        const o = d.data();
        return {
          id: d.id,
          code: o.code,
          type: o.type,
          status: o.status,
          total: o.total,
          items: (o.items || []).map((i) => ({ itemId: i.itemId, name: i.name, qty: i.qty })),
          bulk: o.bulk ? { kg: o.bulk.kg, date: o.bulk.date } : null,
          createdAt: o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : null,
          customerName: o.customer?.name || "",
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20);
    return respond(200, { orders });
  } catch (err) {
    console.error(err);
    return respond(500, { error: "Server xatosi" });
  }
};
