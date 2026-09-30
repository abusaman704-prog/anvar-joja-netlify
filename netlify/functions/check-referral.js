const { getDb } = require("./_lib/firebase-admin");
const { phoneKey } = require("./_lib/util");

// Mijozning ishlatilmagan taklif chegirmasi bormi (faqat foizni qaytaradi)
exports.handler = async function (event) {
  const key = phoneKey(event.queryStringParameters?.phone || "");
  const json = (obj) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  if (key.length < 9) return json({ percent: 0 });
  try {
    const snap = await getDb().collection("referral_credits").where("phone", "==", key).where("used", "==", false).limit(1).get();
    return json({ percent: snap.empty ? 0 : snap.docs[0].data().percent || 5 });
  } catch (err) {
    console.error(err);
    return json({ percent: 0 });
  }
};
