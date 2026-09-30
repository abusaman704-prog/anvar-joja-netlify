const { getDb, admin } = require("./firebase-admin");

// Faqat ruxsat etilgan rollar (masalan ["super_admin"]) chaqira oladi.
// Muvaffaqiyatli bo'lsa { uid, email, role }, aks holda { error: {statusCode, body} } qaytaradi.
async function verifyStaff(event, allowedRoles) {
  const db = getDb(); // Firebase Admin'ni ishga tushiradi
  const header = event.headers.authorization || event.headers.Authorization || "";
  const idToken = header.replace(/^Bearer\s+/i, "");
  if (!idToken) return { error: { statusCode: 401, body: "Ruxsat yo'q" } };

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    return { error: { statusCode: 401, body: "Token yaroqsiz" } };
  }

  const snap = await db.collection("users").doc(decoded.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!role || !allowedRoles.includes(role)) {
    return { error: { statusCode: 403, body: "Bu amal uchun ruxsatingiz yo'q" } };
  }
  return { uid: decoded.uid, email: decoded.email || "", role };
}

module.exports = { verifyStaff };
