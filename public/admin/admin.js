import {
  db, auth, collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "../js/firebase-init.js";
import { imagekitConfig } from "../js/firebase-config.js";

const STATUS_LABELS = {
  yangi: "Yangi", pul_tekshirilmoqda: "To'lov tekshirilmoqda", qabul_qilindi: "Qabul qilindi",
  tayyorlanmoqda: "Tayyorlanmoqda", tayyor: "Tayyor", yetkazilmoqda: "Yetkazilmoqda",
  bajarildi: "Bajarildi", bekor_qilindi: "Bekor qilindi",
};
const ROLE_LABELS = { super_admin: "Super Admin", boshliq: "Boshliq / Oshpaz", ofitsiant: "Ofitsiant" };
const TAB_ACCESS = {
  ofitsiant: ["orders"],
  boshliq: ["orders", "menu", "reviews", "stats", "settings", "qr"],
  super_admin: ["orders", "menu", "reviews", "stats", "settings", "qr", "staff", "audit"],
};

let currentRole = null;
let ORDERS_CACHE = [];
let MENU_CACHE = [];
let ordersUnsub = null;
let reviewsUnsub = null;

/* ============ Yordamchi ============ */
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function safeUrl(u) { return /^https:\/\//i.test(u || "") ? u : ""; }
function formatSom(n) { return Number(n || 0).toLocaleString("uz-UZ") + " so'm"; }
function isBoshliqUp() { return currentRole === "super_admin" || currentRole === "boshliq"; }

function showGlobalError(msg) {
  const el = document.getElementById("global-error");
  el.textContent = msg;
  el.hidden = !msg;
}

async function apiPost(url, body) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi");
  return data;
}

async function uploadToImageKit(file, folder) {
  const authRes = await fetch("/api/imagekit-auth");
  if (!authRes.ok) throw new Error("Yuklash uchun ruxsat olinmadi");
  const a = await authRes.json();
  const fd = new FormData();
  fd.append("file", file);
  fd.append("fileName", `${folder.replace(/\W/g, "")}_${Date.now()}.jpg`);
  fd.append("publicKey", imagekitConfig.publicKey);
  fd.append("signature", a.signature);
  fd.append("expire", a.expire);
  fd.append("token", a.token);
  fd.append("folder", folder);
  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Rasm yuklanmadi");
  return (await res.json()).url;
}

async function logAudit(action, orderId) {
  try {
    await addDoc(collection(db, "audit_logs"), {
      actor: auth.currentUser?.email || "",
      action,
      orderId: orderId || "",
      createdAt: new Date(),
    });
  } catch (e) { console.error(e); }
}

/* ============ Kirish ============ */
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
  } catch (err) {
    errEl.textContent = "Email yoki parol noto'g'ri.";
  }
});
document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
  if (reviewsUnsub) { reviewsUnsub(); reviewsUnsub = null; }

  if (!user) {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("app-screen").hidden = true;
    return;
  }
  let roleSnap;
  try { roleSnap = await getDoc(doc(db, "users", user.uid)); } catch (e) { roleSnap = null; }
  if (!roleSnap || !roleSnap.exists()) {
    document.getElementById("login-error").textContent = "Sizga hali ruxsat berilmagan. Super Admin bilan bog'laning.";
    await signOut(auth);
    return;
  }
  currentRole = roleSnap.data().role;
  if (!TAB_ACCESS[currentRole]) {
    document.getElementById("login-error").textContent = "Rolingiz noma'lum. Super Admin bilan bog'laning.";
    await signOut(auth);
    return;
  }

  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-screen").hidden = false;
  document.getElementById("user-role-label").textContent = ROLE_LABELS[currentRole];

  const allowed = TAB_ACCESS[currentRole];
  document.querySelectorAll(".admin-tabs button").forEach((btn) => { btn.hidden = !allowed.includes(btn.dataset.tab); });
  showTab("orders");

  initOrdersListener();
  if (allowed.includes("menu")) loadMenuAdmin();
  if (allowed.includes("settings")) loadSettingsForm();
  if (allowed.includes("reviews")) initReviewsListener();
});

/* ============ Tablar ============ */
function showTab(name) {
  document.querySelectorAll(".admin-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
  if (name === "stats") renderStats();
  if (name === "staff") loadStaff();
  if (name === "audit") loadAuditLog();
}
document.querySelectorAll(".admin-tabs button").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

/* ============ Buyurtmalar ============ */
function initOrdersListener() {
  ordersUnsub = onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (snap) => {
      showGlobalError("");
      ORDERS_CACHE = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderOrders();
    },
    (err) => { console.error(err); showGlobalError("Buyurtmalarni yuklab bo'lmadi. Internetni tekshiring yoki qayta kiring."); }
  );
}
document.getElementById("filter-status").addEventListener("change", renderOrders);
document.getElementById("filter-type").addEventListener("change", renderOrders);

function nextStatusFor(order) {
  let flow;
  if (order.type === "table") flow = ["yangi", "qabul_qilindi", "tayyorlanmoqda", "tayyor", "bajarildi"];
  else if (order.type === "delivery" || (order.type === "bulk" && order.bulk?.type === "delivery"))
    flow = ["pul_tekshirilmoqda", "qabul_qilindi", "tayyorlanmoqda", "tayyor", "yetkazilmoqda", "bajarildi"];
  else flow = ["pul_tekshirilmoqda", "qabul_qilindi", "tayyorlanmoqda", "tayyor", "bajarildi"];
  const idx = flow.indexOf(order.status);
  return idx >= 0 ? flow[idx + 1] || null : null;
}

function renderOrders() {
  const statusFilter = document.getElementById("filter-status").value;
  const typeFilter = document.getElementById("filter-type").value;
  const wrap = document.getElementById("orders-list");

  let list = ORDERS_CACHE;
  if (statusFilter) list = list.filter((o) => o.status === statusFilter);
  if (typeFilter) list = list.filter((o) => o.type === typeFilter);
  if (list.length === 0) { wrap.innerHTML = `<p class="hint">Buyurtmalar topilmadi.</p>`; return; }

  wrap.innerHTML = "";
  list.forEach((order) => {
    const el = document.createElement("div");
    el.className = "order-card";
    const badgeClass = order.status === "yangi" || order.status === "pul_tekshirilmoqda" ? "new"
      : order.status === "bajarildi" ? "done" : order.status === "bekor_qilindi" ? "cancelled" : "";
    const typeLabel = order.type === "pickup" ? "Olib ketish" : order.type === "delivery" ? "Yetkazish"
      : order.type === "table" ? `Stol ${esc(order.tableNumber)}` : "Katta buyurtma";
    const itemsText = order.type === "bulk"
      ? `${order.bulk?.kg ?? "?"} kg jo'ja, sana: ${order.bulk?.date ?? ""} (${order.bulk?.type === "delivery" ? "yetkazish" : "olib ketish"})`
      : (order.items || []).map((i) => `${i.name} x${i.qty}`).join(", ");
    const receipt = safeUrl(order.payment?.receiptUrl);
    const paidLine = order.type === "table"
      ? "To'lov: stolda"
      : `Mijoz yozgan summa: ${formatSom(order.payment?.amountEntered)}${order.type === "bulk" ? ` (avans kerak: ${formatSom(order.payment?.advanceRequired)})` : ""}`;

    el.innerHTML = `
      <div class="order-card-top">
        <div>
          <p class="order-code">${esc(order.code || order.id)}</p>
          <p class="order-meta">${esc(order.customer?.name)} · ${esc(order.customer?.phone)}</p>
          <p class="order-meta">${typeLabel}</p>
        </div>
        <span class="order-badge ${badgeClass}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
      </div>
      <p class="order-items">${esc(itemsText)}</p>
      <p class="order-meta">Jami: ${formatSom(order.total)}${order.discountAmount ? ` (chegirma -${formatSom(order.discountAmount)})` : ""}</p>
      <p class="order-meta">${esc(paidLine)}</p>
      ${order.customer?.address ? `<p class="order-meta">Manzil: ${esc(order.customer.address)}</p>` : ""}
      ${order.customer?.comment ? `<p class="order-meta">Izoh: ${esc(order.customer.comment)}</p>` : ""}
      ${receipt ? `<a class="order-receipt-link" href="${esc(receipt)}" target="_blank" rel="noopener noreferrer">Chekni ko'rish →</a>` : ""}
      <div class="order-actions"></div>`;
    renderOrderActions(el.querySelector(".order-actions"), order);
    wrap.appendChild(el);
  });
}

function actionBtn(container, label, cls, handler) {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await handler(); } catch (err) { console.error(err); alert("Amal bajarilmadi. Ruxsatingiz yo'q yoki internet uzilgan bo'lishi mumkin."); b.disabled = false; }
  });
  container.appendChild(b);
}

function renderOrderActions(container, order) {
  if (order.status === "bekor_qilindi" || order.status === "bajarildi") return;

  if (order.status === "pul_tekshirilmoqda") {
    if (isBoshliqUp()) {
      actionBtn(container, "To'lovni tasdiqlash", "primary", () => confirmPayment(order.id));
      actionBtn(container, "Bekor qilish", "danger", () => cancelOrder(order.id));
    } else {
      container.innerHTML = `<span class="order-meta">To'lovni Boshliq tasdiqlaydi</span>`;
    }
    return;
  }
  const next = nextStatusFor(order);
  if (next) actionBtn(container, STATUS_LABELS[next], "primary", () => updateOrderStatus(order.id, next, order));
  if (isBoshliqUp()) actionBtn(container, "Bekor qilish", "danger", () => cancelOrder(order.id));
}

async function confirmPayment(orderId) {
  await updateDoc(doc(db, "orders", orderId), { "payment.status": "tasdiqlangan", status: "qabul_qilindi" });
  await logAudit("to'lov tasdiqlandi", orderId);
}
async function cancelOrder(orderId) {
  if (!confirm("Rostdan ham bu buyurtmani bekor qilasizmi?")) return;
  await updateDoc(doc(db, "orders", orderId), { status: "bekor_qilindi", "payment.status": "bekor" });
  await logAudit("bekor qilindi", orderId);
}
async function updateOrderStatus(orderId, status, order) {
  await updateDoc(doc(db, "orders", orderId), { status });
  await logAudit(`holat: ${status}`, orderId);
  if (status === "bajarildi" && order.referredByKey) await issueReferralCredit(order, orderId);
}
async function issueReferralCredit(order, orderId) {
  try {
    const existing = await getDocs(query(collection(db, "referral_credits"), where("fromOrderId", "==", orderId), limit(1)));
    if (!existing.empty) return;
    await addDoc(collection(db, "referral_credits"), {
      phone: order.referredByKey, percent: 5, used: false,
      fromOrderId: orderId, fromOrderCode: order.code, createdAt: new Date(),
    });
  } catch (e) { console.error(e); }
}

/* ============ Menyu ============ */
async function loadMenuAdmin() {
  const snap = await getDocs(query(collection(db, "menu"), orderBy("order", "asc")));
  MENU_CACHE = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderMenuAdmin();
}
function renderMenuAdmin() {
  const wrap = document.getElementById("menu-admin-list");
  document.getElementById("seed-menu-btn").hidden = !(currentRole === "super_admin" && MENU_CACHE.length === 0);
  if (MENU_CACHE.length === 0) { wrap.innerHTML = `<p class="hint">Hali taom qo'shilmagan.</p>`; return; }
  wrap.innerHTML = "";
  MENU_CACHE.forEach((item) => {
    const row = document.createElement("div");
    row.className = "menu-admin-row" + (item.visible === false ? " hidden-item" : "");
    row.innerHTML = `<div><p class="name">${esc(item.name)}</p><p class="sub">${esc(item.category)} · ${formatSom(item.price)}${item.unitLabel ? " / " + esc(item.unitLabel) : ""}${item.visible === false ? " · yashirin" : ""}</p></div>`;
    row.addEventListener("click", () => openItemModal(item));
    wrap.appendChild(row);
  });
}

document.getElementById("seed-menu-btn").addEventListener("click", async () => {
  const status = document.getElementById("menu-status");
  status.textContent = "Yuklanmoqda…";
  try {
    const res = await apiPost("/api/seed-menu");
    status.textContent = res.added ? `${res.added} ta taom qo'shildi.` : res.message;
    await loadMenuAdmin();
  } catch (err) { status.textContent = "Xatolik: " + err.message; }
});

const itemForm = document.getElementById("item-form");
const imagePreview = document.getElementById("item-image-preview");

function setItemImage(url) {
  itemForm.imageUrl.value = url || "";
  imagePreview.hidden = !url;
  if (url) imagePreview.querySelector("img").src = url;
  document.getElementById("remove-image-btn").hidden = !url;
}
itemForm.imageFile.addEventListener("change", () => {
  const f = itemForm.imageFile.files[0];
  if (f) {
    imagePreview.hidden = false;
    imagePreview.querySelector("img").src = URL.createObjectURL(f);
  }
});
document.getElementById("remove-image-btn").addEventListener("click", () => { itemForm.imageFile.value = ""; setItemImage(""); });

document.getElementById("add-item-btn").addEventListener("click", () => openItemModal(null));
function openItemModal(item) {
  itemForm.reset();
  document.getElementById("item-modal-title").textContent = item ? "Taomni tahrirlash" : "Yangi taom";
  document.getElementById("delete-item-btn").hidden = !item;
  document.getElementById("item-image-status").textContent = "Yangi rasm tanlasangiz, saqlaganda yuklanadi.";
  if (item) {
    itemForm.id.value = item.id; itemForm.name.value = item.name; itemForm.category.value = item.category;
    itemForm.priceType.value = item.priceType || "portion"; itemForm.price.value = item.price;
    itemForm.unitLabel.value = item.unitLabel || "";
    itemForm.visible.checked = item.visible !== false; itemForm.order.value = item.order ?? 1;
    setItemImage(safeUrl(item.imageUrl));
  } else {
    itemForm.id.value = "";
    itemForm.visible.checked = true;
    itemForm.order.value = MENU_CACHE.length + 1;
    setItemImage("");
  }
  document.getElementById("item-modal").showModal();
}
document.querySelectorAll('[data-close="item-modal"]').forEach((b) => b.addEventListener("click", () => document.getElementById("item-modal").close()));

itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById("item-save-btn");
  const statusEl = document.getElementById("item-image-status");
  saveBtn.disabled = true;
  try {
    const fd = new FormData(itemForm);
    let imageUrl = String(fd.get("imageUrl") || "");
    const file = itemForm.imageFile.files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) throw new Error("Rasm hajmi 10 MB dan oshmasin");
      statusEl.textContent = "Rasm yuklanmoqda…";
      imageUrl = await uploadToImageKit(file, "/anvar-joja-menyu");
    }
    const payload = {
      name: String(fd.get("name")).trim(), category: fd.get("category"), priceType: fd.get("priceType"),
      price: Number(fd.get("price")), unitLabel: String(fd.get("unitLabel") || "").trim(), imageUrl,
      visible: fd.get("visible") === "on", order: Number(fd.get("order")) || 1,
    };
    const id = fd.get("id");
    if (id) { await updateDoc(doc(db, "menu", id), payload); await logAudit(`menyu tahrirlandi: ${payload.name}`); }
    else { await addDoc(collection(db, "menu"), payload); await logAudit(`yangi taom: ${payload.name}`); }
    document.getElementById("item-modal").close();
    loadMenuAdmin();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Xatolik: " + err.message;
  } finally {
    saveBtn.disabled = false;
  }
});
document.getElementById("delete-item-btn").addEventListener("click", async () => {
  const id = itemForm.id.value;
  if (!id || !confirm("Bu taomni butunlay o'chirasizmi?")) return;
  await deleteDoc(doc(db, "menu", id));
  await logAudit("taom o'chirildi");
  document.getElementById("item-modal").close();
  loadMenuAdmin();
});

/* ============ Sharhlar ============ */
function initReviewsListener() {
  reviewsUnsub = onSnapshot(query(collection(db, "reviews"), orderBy("createdAt", "desc")), (snap) => {
    const wrap = document.getElementById("reviews-admin-list");
    if (snap.empty) { wrap.innerHTML = `<p class="hint">Hali sharh yo'q.</p>`; return; }
    wrap.innerHTML = "";
    snap.docs.forEach((d) => {
      const r = { id: d.id, ...d.data() };
      const rating = Math.min(5, Math.max(1, Number(r.rating) || 5));
      const el = document.createElement("div");
      el.className = "order-card";
      el.innerHTML = `
        <p class="order-code">${"★".repeat(rating)} · ${esc(r.customerName || "Mijoz")}</p>
        <p class="order-items">${esc(r.text)}</p>
        <p class="order-meta">${r.approved ? "Tasdiqlangan" : "Tasdiqlash kutilmoqda"}</p>
        <div class="order-actions"></div>`;
      const actions = el.querySelector(".order-actions");
      if (!r.approved) actionBtn(actions, "Tasdiqlash", "primary", () => updateDoc(doc(db, "reviews", r.id), { approved: true }));
      actionBtn(actions, "O'chirish", "danger", async () => { if (confirm("O'chirilsinmi?")) await deleteDoc(doc(db, "reviews", r.id)); });
      wrap.appendChild(el);
    });
  }, (err) => console.error(err));
}

/* ============ Statistika ============ */
function renderStats() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7)); // dushanbadan
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const toDate = (o) => (o.createdAt?.toDate ? o.createdAt.toDate() : new Date(0));
  // Bekor qilingan va to'lovi hali tasdiqlanmagan buyurtmalar tushumga kirmaydi
  const counted = ORDERS_CACHE.filter((o) => o.status !== "bekor_qilindi" && o.status !== "pul_tekshirilmoqda");
  const sum = (list) => list.reduce((s, o) => s + (o.total || 0), 0);
  const today = counted.filter((o) => toDate(o) >= startOfDay);
  const week = counted.filter((o) => toDate(o) >= startOfWeek);
  const month = counted.filter((o) => toDate(o) >= startOfMonth);

  const counts = {};
  counted.forEach((o) => (o.items || []).forEach((i) => { counts[i.name] = (counts[i.name] || 0) + i.qty; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const byType = (t) => counted.filter((o) => o.type === t).length;

  const cards = [
    { label: "Bugungi buyurtmalar", value: today.length },
    { label: "Bugungi tushum", value: formatSom(sum(today)) },
    { label: "Shu haftadagi buyurtmalar", value: week.length },
    { label: "Shu haftadagi tushum", value: formatSom(sum(week)) },
    { label: "Shu oydagi buyurtmalar", value: month.length },
    { label: "Shu oydagi tushum", value: formatSom(sum(month)) },
    { label: "Eng ko'p sotilgan", value: top ? `${top[0]} (${top[1]})` : "—" },
    { label: "Olib ketish / Yetkazish / Stol", value: `${byType("pickup")} / ${byType("delivery")} / ${byType("table")}` },
  ];
  const wrap = document.getElementById("stats-grid");
  wrap.innerHTML = "";
  cards.forEach((c) => {
    const el = document.createElement("div");
    el.className = "stat-card";
    el.innerHTML = `<p class="stat-label">${esc(c.label)}</p><p class="stat-value">${esc(c.value)}</p>`;
    wrap.appendChild(el);
  });
}

function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excel formulasi orqali hujumdan himoya
  return `"${s.replace(/"/g, '""')}"`;
}
document.getElementById("export-csv-btn").addEventListener("click", () => {
  const rows = [["Kod", "Sana", "Turi", "Holat", "Mijoz", "Telefon", "Jami", "Taomlar"]];
  ORDERS_CACHE.forEach((o) => {
    const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("uz-UZ") : "";
    const itemsText = o.type === "bulk" ? `${o.bulk?.kg || ""} kg` : (o.items || []).map((i) => `${i.name} x${i.qty}`).join("; ");
    rows.push([o.code || o.id, date, o.type, STATUS_LABELS[o.status] || o.status, o.customer?.name, o.customer?.phone, o.total ?? 0, itemsText]);
  });
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `anvar-joja-buyurtmalar-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ============ Sozlamalar ============ */
async function loadSettingsForm() {
  const snap = await getDoc(doc(db, "settings", "general"));
  const form = document.getElementById("settings-form");
  if (!snap.exists()) return;
  const d = snap.data();
  form.openTime.value = d.workHours?.open || "10:00";
  form.closeTime.value = d.workHours?.close || "23:00";
  form.promoText.value = d.promoText || "";
  form.promoActive.checked = !!d.promoActive;
  form.cardNumber.value = d.cardNumber || "";
  form.cardHolder.value = d.cardHolder || "";
  form.phone.value = d.phone || "";
  form.instagramUrl.value = d.instagramUrl || "";
  form.mapUrl.value = d.mapUrl || "";
  form.isOpenOverride.value = d.isOpenOverride === true ? "true" : d.isOpenOverride === false ? "false" : "";
}
document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ov = fd.get("isOpenOverride");
  const statusEl = document.getElementById("settings-status");
  try {
    await setDoc(doc(db, "settings", "general"), {
      workHours: { open: fd.get("openTime"), close: fd.get("closeTime") },
      promoText: fd.get("promoText"), promoActive: fd.get("promoActive") === "on",
      cardNumber: fd.get("cardNumber"), cardHolder: fd.get("cardHolder"),
      phone: fd.get("phone"), instagramUrl: fd.get("instagramUrl"), mapUrl: fd.get("mapUrl"),
      isOpenOverride: ov === "" ? null : ov === "true",
    }, { merge: true });
    await logAudit("sozlamalar yangilandi");
    statusEl.textContent = "Saqlandi.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Saqlab bo'lmadi.";
  }
  setTimeout(() => (statusEl.textContent = ""), 2500);
});

/* ============ QR-stollar ============ */
document.getElementById("qr-generate-btn").addEventListener("click", () => {
  const grid = document.getElementById("qr-grid");
  if (typeof window.QRCode === "undefined") {
    grid.innerHTML = `<p class="hint error">QR kutubxonasi yuklanmadi. Internetni tekshirib, sahifani yangilang.</p>`;
    return;
  }
  const count = Math.min(99, Math.max(1, parseInt(document.getElementById("qr-count").value, 10) || 10));
  grid.innerHTML = "";
  for (let n = 1; n <= count; n++) {
    const url = `${window.location.origin}/table/${n}`;
    const card = document.createElement("div");
    card.className = "qr-card";
    card.innerHTML = `<div class="qr-box"></div><p class="qr-title">${n}-stol</p><p class="qr-sub">${esc(url)}</p>`;
    grid.appendChild(card);
    new window.QRCode(card.querySelector(".qr-box"), { text: url, width: 150, height: 150 });
  }
  document.getElementById("qr-print-btn").hidden = false;
});
document.getElementById("qr-print-btn").addEventListener("click", () => window.print());

/* ============ Xodimlar (Super Admin) ============ */
async function loadStaff() {
  const wrap = document.getElementById("staff-list");
  wrap.innerHTML = `<p class="hint">Yuklanmoqda…</p>`;
  try {
    const { staff } = await apiPost("/api/staff", { action: "list" });
    wrap.innerHTML = "";
    staff.forEach((s) => {
      const isSelf = s.uid === auth.currentUser.uid;
      const el = document.createElement("div");
      el.className = "order-card";
      el.innerHTML = `<div class="staff-row"><div><p class="order-code">${esc(s.name || "Ismsiz")}${isSelf ? " (siz)" : ""}</p><p class="order-meta">${esc(s.email)}</p></div><div class="staff-controls"></div></div>`;
      const controls = el.querySelector(".staff-controls");
      if (!isSelf) {
        const sel = document.createElement("select");
        Object.entries(ROLE_LABELS).forEach(([value, label]) => {
          const o = document.createElement("option");
          o.value = value; o.textContent = label; o.selected = value === s.role;
          sel.appendChild(o);
        });
        sel.addEventListener("change", async () => {
          try { await apiPost("/api/staff", { action: "setRole", uid: s.uid, role: sel.value }); }
          catch (err) { alert(err.message); loadStaff(); }
        });
        controls.appendChild(sel);
        const del = document.createElement("button");
        del.className = "btn-ghost";
        del.style.color = "#C23B2A";
        del.textContent = "O'chirish";
        del.addEventListener("click", async () => {
          if (!confirm(`${s.name || s.email} tizimdan o'chirilsinmi?`)) return;
          try { await apiPost("/api/staff", { action: "delete", uid: s.uid }); loadStaff(); }
          catch (err) { alert(err.message); }
        });
        controls.appendChild(del);
      } else {
        controls.textContent = ROLE_LABELS[s.role] || s.role;
      }
      wrap.appendChild(el);
    });
  } catch (err) {
    wrap.innerHTML = `<p class="hint error">Xodimlar ro'yxatini yuklab bo'lmadi: ${esc(err.message)}</p>`;
  }
}
document.getElementById("staff-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const statusEl = document.getElementById("staff-status");
  statusEl.textContent = "Yaratilmoqda…";
  try {
    await apiPost("/api/staff", { action: "create", email: fd.get("email"), password: fd.get("password"), name: fd.get("name"), role: fd.get("role") });
    statusEl.textContent = "Xodim qo'shildi.";
    e.target.reset();
    loadStaff();
  } catch (err) {
    statusEl.textContent = "Xatolik: " + err.message;
  }
});

/* ============ Tarix (audit log) ============ */
async function loadAuditLog() {
  const wrap = document.getElementById("audit-list");
  wrap.innerHTML = `<p class="hint">Yuklanmoqda…</p>`;
  try {
    const snap = await getDocs(query(collection(db, "audit_logs"), orderBy("createdAt", "desc"), limit(100)));
    if (snap.empty) { wrap.innerHTML = `<p class="hint">Hali amal yo'q.</p>`; return; }
    wrap.innerHTML = "";
    snap.docs.forEach((d) => {
      const log = d.data();
      const date = log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString("uz-UZ") : "";
      const el = document.createElement("div");
      el.className = "order-card";
      el.innerHTML = `<p class="order-meta">${esc(date)}</p><p class="order-items">${esc(log.actor)}: ${esc(log.action)}</p>`;
      wrap.appendChild(el);
    });
  } catch (e) {
    console.error(e);
    wrap.innerHTML = `<p class="hint error">Tarixni yuklab bo'lmadi.</p>`;
  }
}
