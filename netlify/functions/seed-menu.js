const { getDb } = require("./_lib/firebase-admin");
const { verifyStaff } = require("./_lib/auth");

const SEED_ITEMS = [
  { name: "Butun qovurilgan jo'ja", category: "joja", priceType: "portion", price: 55000, unitLabel: "butun", order: 1 },
  { name: "Jo'ja 1 kg", category: "joja", priceType: "kg", price: 100000, unitLabel: "1 kg", order: 2 },
  { name: "Qozon kabob", category: "milliy", priceType: "portion", price: 100000, unitLabel: "porsiya", order: 3 },
  { name: "Lag'mon", category: "milliy", priceType: "portion", price: 45000, unitLabel: "porsiya", order: 4 },
  { name: "Jiz", category: "milliy", priceType: "portion", price: 95000, unitLabel: "porsiya", order: 5 },
  { name: "Tushonka", category: "milliy", priceType: "portion", price: 65000, unitLabel: "porsiya", order: 6 },
  { name: "Juvavo", category: "milliy", priceType: "portion", price: 45000, unitLabel: "porsiya", order: 7 },
  { name: "Mastava", category: "milliy", priceType: "portion", price: 45000, unitLabel: "porsiya", order: 8 },
  { name: "Mantar", category: "milliy", priceType: "portion", price: 45000, unitLabel: "porsiya", order: 9 },
  { name: "Jaz mol", category: "shashlik", priceType: "portion", price: 22000, unitLabel: "sich", order: 10 },
  { name: "Jaz qo'y", category: "shashlik", priceType: "portion", price: 22000, unitLabel: "sich", order: 11 },
  { name: "Qiyma shashlik", category: "shashlik", priceType: "portion", price: 20000, unitLabel: "sich", order: 12 },
  { name: "Tovuq qanoti", category: "shashlik", priceType: "portion", price: 22000, unitLabel: "sich", order: 13 },
  { name: "Grudinka shashlik", category: "shashlik", priceType: "portion", price: 20000, unitLabel: "sich", order: 14 },
  { name: "Jigar shashlik", category: "shashlik", priceType: "portion", price: 20000, unitLabel: "sich", order: 15 },
];

exports.handler = async function (event) {
  const respond = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  if (event.httpMethod !== "POST") return respond(405, { error: "Faqat POST" });

  const caller = await verifyStaff(event, ["super_admin"]);
  if (caller.error) return respond(caller.error.statusCode, { error: caller.error.body });

  try {
    const db = getDb();
    const existing = await db.collection("menu").limit(1).get();
    if (!existing.empty) return respond(200, { added: 0, message: "Menyu allaqachon to'ldirilgan, hech narsa qilinmadi." });

    const batch = db.batch();
    SEED_ITEMS.forEach((item) => {
      batch.set(db.collection("menu").doc(), { ...item, visible: true, imageUrl: "" });
    });
    await batch.commit();
    return respond(200, { added: SEED_ITEMS.length });
  } catch (err) {
    console.error(err);
    return respond(500, { error: "Server xatosi" });
  }
};
