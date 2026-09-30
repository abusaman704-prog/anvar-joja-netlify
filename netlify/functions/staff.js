const { getDb, admin } = require("./_lib/firebase-admin");
const { verifyStaff } = require("./_lib/auth");

const ROLES = ["super_admin", "boshliq", "ofitsiant"];

// Faqat Super Admin: xodimlar ro'yxati, qo'shish, rolini o'zgartirish, o'chirish
exports.handler = async function (event) {
  const respond = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  if (event.httpMethod !== "POST") return respond(405, { error: "Faqat POST" });

  const caller = await verifyStaff(event, ["super_admin"]);
  if (caller.error) return respond(caller.error.statusCode, { error: caller.error.body });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return respond(400, { error: "Noto'g'ri so'rov" }); }

  const db = getDb();
  const audit = (action) =>
    db.collection("audit_logs").add({ actor: caller.email, action, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  try {
    if (body.action === "list") {
      const snap = await db.collection("users").get();
      const uids = snap.docs.map((d) => ({ uid: d.id }));
      const emails = {};
      if (uids.length > 0) {
        const res = await admin.auth().getUsers(uids.slice(0, 100));
        res.users.forEach((u) => { emails[u.uid] = u.email || ""; });
      }
      const staff = snap.docs.map((d) => ({ uid: d.id, name: d.data().name || "", role: d.data().role, email: emails[d.id] || "" }));
      return respond(200, { staff });
    }

    if (body.action === "create") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      const name = String(body.name || "").trim().slice(0, 60);
      if (!email || password.length < 6) return respond(400, { error: "Email va kamida 6 belgili parol kerak" });
      if (!ROLES.includes(body.role)) return respond(400, { error: "Noto'g'ri rol" });
      const user = await admin.auth().createUser({ email, password, displayName: name });
      await db.collection("users").doc(user.uid).set({ role: body.role, name });
      await audit(`yangi xodim qo'shildi: ${email} (${body.role})`);
      return respond(200, { ok: true, uid: user.uid });
    }

    if (body.action === "setRole") {
      if (!ROLES.includes(body.role)) return respond(400, { error: "Noto'g'ri rol" });
      if (body.uid === caller.uid) return respond(400, { error: "O'z rolingizni o'zgartira olmaysiz" });
      await db.collection("users").doc(String(body.uid)).update({ role: body.role });
      await audit(`xodim roli o'zgardi: ${body.uid} -> ${body.role}`);
      return respond(200, { ok: true });
    }

    if (body.action === "delete") {
      if (body.uid === caller.uid) return respond(400, { error: "O'zingizni o'chira olmaysiz" });
      await admin.auth().deleteUser(String(body.uid));
      await db.collection("users").doc(String(body.uid)).delete();
      await audit(`xodim o'chirildi: ${body.uid}`);
      return respond(200, { ok: true });
    }

    return respond(400, { error: "Noma'lum amal" });
  } catch (err) {
    console.error(err);
    return respond(500, { error: err.message || "Server xatosi" });
  }
};
