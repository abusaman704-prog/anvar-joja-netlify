import {
  db, collection, doc, getDoc, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp,
} from "./firebase-init.js";
import { imagekitConfig, paymentConfig, deliveryFeeNote } from "./firebase-config.js";

/* ============ Umumiy holat ============ */
let MENU = [];
let menuLoaded = false;
let SETTINGS = {
  workHours: { open: "10:00", close: "23:00" },
  promoText: "Qovurilgan jo'ja buyurtmasiga sous bepul",
  promoActive: true,
  isOpenOverride: null,
};
let activeCategory = "joja";
let cart = JSON.parse(localStorage.getItem("aj_cart") || "[]");
let favorites = JSON.parse(localStorage.getItem("aj_favorites") || "[]");
let pendingOrder = null;
let reviewContext = null;

// Stol raqami manzildan olinadi: /table/3 (QR-kod havolasi)
const tableMatch = window.location.pathname.match(/^\/table\/(\d{1,2})\/?$/);
const tableNumber = tableMatch ? String(parseInt(tableMatch[1], 10)) : null;

const CATEGORY_LABELS = { joja: "Jo'ja", milliy: "Milliy taomlar", shashlik: "Shashlik" };
const STATUS_LABELS = {
  yangi: "Yangi", pul_tekshirilmoqda: "To'lov tekshirilmoqda", qabul_qilindi: "Qabul qilindi",
  tayyorlanmoqda: "Tayyorlanmoqda", tayyor: "Tayyor", yetkazilmoqda: "Yetkazilmoqda",
  bajarildi: "Bajarildi", bekor_qilindi: "Bekor qilindi",
};

/* ============ Yordamchi ============ */
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
function formatSom(n) { return Number(n || 0).toLocaleString("uz-UZ") + " so'm"; }
function saveCart() { localStorage.setItem("aj_cart", JSON.stringify(cart)); }
function saveFavorites() { localStorage.setItem("aj_favorites", JSON.stringify(favorites)); }
function openDialog(id) { document.getElementById(id).showModal(); }
function closeDialog(id) { document.getElementById(id).close(); }
document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => closeDialog(btn.dataset.close)));

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Xatolik yuz berdi");
    err.userFacing = Boolean(data.error);
    throw err;
  }
  return data;
}

/* ============ Stol banneri ============ */
if (tableNumber) {
  document.getElementById("table-banner").hidden = false;
  document.getElementById("table-banner-num").textContent = tableNumber;
}

/* ============ Ish vaqti ============ */
function computeIsOpen() {
  if (SETTINGS.isOpenOverride === true) return true;
  if (SETTINGS.isOpenOverride === false) return false;
  const now = new Date();
  const [openH, openM] = SETTINGS.workHours.open.split(":").map(Number);
  const [closeH, closeM] = SETTINGS.workHours.close.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= openH * 60 + openM && nowMin < closeH * 60 + closeM;
}
function renderOpenStatus() {
  const pill = document.getElementById("open-status");
  const isOpen = computeIsOpen();
  pill.classList.toggle("closed", !isOpen);
  pill.querySelector(".status-text").textContent = isOpen
    ? "Hozir ochiq"
    : `Hozir yopiq (${SETTINGS.workHours.open}–${SETTINGS.workHours.close})`;
}
function ensureOpen() {
  if (computeIsOpen()) return true;
  alert(`Hozir yopiqmiz. Ish vaqti: ${SETTINGS.workHours.open}–${SETTINGS.workHours.close}. Katta buyurtmani (5 kg dan ortiq) oldindan berishingiz mumkin.`);
  return false;
}

/* ============ Ma'lumotlarni yuklash ============ */
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "general"));
    if (snap.exists()) SETTINGS = { ...SETTINGS, ...snap.data() };
  } catch (e) { console.error(e); }
  renderOpenStatus();
  document.getElementById("promo-box").hidden = !SETTINGS.promoActive;
  document.querySelector(".promo-text").textContent = SETTINGS.promoText || "";
  if (SETTINGS.phone) document.getElementById("footer-phone").href = `tel:${SETTINGS.phone}`;
  if (safeUrl(SETTINGS.instagramUrl)) document.getElementById("footer-instagram").href = SETTINGS.instagramUrl;
  if (safeUrl(SETTINGS.mapUrl)) document.getElementById("footer-map").href = SETTINGS.mapUrl;
}

async function loadMenu() {
  try {
    // Faqat bitta maydon bo'yicha saralanadi (qo'shimcha indeks talab qilmaydi);
    // ko'rinmaydigan taomlar shu yerda filtrlanadi.
    const snap = await getDocs(query(collection(db, "menu"), orderBy("order", "asc")));
    MENU = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.visible !== false);
    menuLoaded = true;
  } catch (e) { console.error(e); MENU = []; }
  syncCartWithMenu();
  renderTabs();
  renderMenu();
}

// Savatdagi narx/nomni joriy menyuga moslaydi, menyudan olib tashlangan taomlarni o'chiradi
function syncCartWithMenu() {
  if (!menuLoaded) return;
  const before = JSON.stringify(cart);
  cart = cart
    .filter((c) => MENU.some((m) => m.id === c.itemId))
    .map((c) => {
      const m = MENU.find((x) => x.id === c.itemId);
      return { ...c, name: m.name, price: m.price, unitLabel: m.unitLabel || "" };
    });
  if (JSON.stringify(cart) !== before) saveCart();
  renderCartBar();
}

async function loadReviews() {
  try {
    const snap = await getDocs(query(collection(db, "reviews"), where("approved", "==", true), limit(30)));
    const reviews = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .slice(0, 10);
    if (reviews.length === 0) return;
    document.getElementById("reviews-section").hidden = false;
    const wrap = document.getElementById("reviews-list");
    wrap.innerHTML = "";
    reviews.forEach((r) => {
      const rating = Math.min(5, Math.max(1, Number(r.rating) || 5));
      const el = document.createElement("div");
      el.className = "review-card";
      el.innerHTML = `
        <div class="review-stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</div>
        <p class="review-text">${esc(r.text)}</p>
        <p class="review-name">${esc(r.customerName || "Mijoz")}</p>`;
      wrap.appendChild(el);
    });
  } catch (e) { console.error(e); }
}

/* ============ Menyu ============ */
function renderTabs() {
  const cats = [...new Set(MENU.map((m) => m.category))];
  const wrap = document.getElementById("category-tabs");
  wrap.innerHTML = "";
  if (cats.length === 0) return;
  if (!cats.includes(activeCategory)) activeCategory = cats[0];
  cats.forEach((cat) => {
    const btn = document.createElement("button");
    btn.textContent = CATEGORY_LABELS[cat] || cat;
    btn.className = cat === activeCategory ? "active" : "";
    btn.addEventListener("click", () => { activeCategory = cat; renderTabs(); renderMenu(); });
    wrap.appendChild(btn);
  });
}

function renderMenu() {
  const wrap = document.getElementById("menu-list");
  if (MENU.length === 0) {
    wrap.innerHTML = `<p class="menu-empty">Menyu yuklanmadi. Sahifani yangilang yoki keyinroq urinib ko'ring.</p>`;
    return;
  }
  const items = MENU.filter((m) => m.category === activeCategory);
  wrap.innerHTML = "";
  items.forEach((item) => wrap.appendChild(renderMenuItemEl(item)));
}

function renderMenuItemEl(item) {
  const el = document.createElement("div");
  el.className = "menu-item";
  const isFav = favorites.includes(item.id);
  const img = safeUrl(item.imageUrl);
  el.innerHTML = `
    <button class="menu-item-fav ${isFav ? "active" : ""}" aria-label="Sevimlilarga qo'shish">❤</button>
    <div class="menu-item-img">${img ? `<img src="${esc(img)}" alt="${esc(item.name)}" loading="lazy" />` : "🍗"}</div>
    <div class="menu-item-info">
      <p class="menu-item-name">${esc(item.name)}</p>
      <p class="menu-item-price">${formatSom(item.price)}${item.unitLabel ? " / " + esc(item.unitLabel) : ""}</p>
    </div>
    <button class="menu-item-add" aria-label="Savatga qo'shish">+</button>`;
  el.querySelector(".menu-item-add").addEventListener("click", () => addToCart(item));
  el.querySelector(".menu-item-fav").addEventListener("click", (e) => toggleFavorite(item.id, e.currentTarget));
  return el;
}

function toggleFavorite(itemId, btnEl) {
  if (favorites.includes(itemId)) favorites = favorites.filter((id) => id !== itemId);
  else favorites.push(itemId);
  saveFavorites();
  if (btnEl) btnEl.classList.toggle("active");
}

/* ============ Savat ============ */
function addToCart(item, qty = 1) {
  const existing = cart.find((c) => c.itemId === item.id);
  if (existing) existing.qty = Math.min(50, existing.qty + qty);
  else cart.push({ itemId: item.id, name: item.name, price: item.price, unitLabel: item.unitLabel || "", qty });
  saveCart();
  renderCartBar();
}
function changeQty(itemId, delta) {
  const line = cart.find((c) => c.itemId === itemId);
  if (!line) return;
  line.qty = Math.min(50, line.qty + delta);
  if (line.qty <= 0) cart = cart.filter((c) => c.itemId !== itemId);
  saveCart(); renderCartBar(); renderCartModal();
}
function cartTotal() { return cart.reduce((s, c) => s + c.price * c.qty, 0); }
function cartCount() { return cart.reduce((s, c) => s + c.qty, 0); }

function renderCartBar() {
  const bar = document.getElementById("cart-bar");
  if (cart.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById("cart-count").textContent = `${cartCount()} mahsulot`;
  document.getElementById("cart-total").textContent = cartTotal().toLocaleString("uz-UZ");
}

function renderCartModal() {
  const wrap = document.getElementById("cart-items");
  if (cart.length === 0) {
    wrap.innerHTML = `<p class="menu-empty">Savat bo'sh.</p>`;
  } else {
    wrap.innerHTML = "";
    cart.forEach((line) => {
      const el = document.createElement("div");
      el.className = "cart-line";
      el.innerHTML = `
        <div><p class="cart-line-name">${esc(line.name)}</p><p class="cart-line-sub">${formatSom(line.price)}${line.unitLabel ? " / " + esc(line.unitLabel) : ""}</p></div>
        <div class="qty-control"><button data-action="minus" aria-label="Kamaytirish">−</button><span>${line.qty}</span><button data-action="plus" aria-label="Ko'paytirish">+</button></div>`;
      el.querySelector('[data-action="minus"]').addEventListener("click", () => changeQty(line.itemId, -1));
      el.querySelector('[data-action="plus"]').addEventListener("click", () => changeQty(line.itemId, 1));
      wrap.appendChild(el);
    });
  }
  document.getElementById("cart-modal-total").textContent = formatSom(cartTotal());
}

document.getElementById("cart-open-btn").addEventListener("click", () => { renderCartModal(); openDialog("cart-modal"); });
document.getElementById("go-checkout-btn").addEventListener("click", () => {
  if (cart.length === 0) return;
  if (!ensureOpen()) return;
  closeDialog("cart-modal");
  if (tableNumber) document.getElementById("order-type-field").hidden = true;
  openDialog("checkout-modal");
});

/* ============ Buyurtma berish ============ */
document.querySelectorAll('input[name="orderType"]').forEach((r) => {
  r.addEventListener("change", (e) => {
    const isDelivery = e.target.value === "delivery";
    document.getElementById("address-field").hidden = !isDelivery;
    document.getElementById("address-field").querySelector("textarea").required = isDelivery;
    const hint = document.getElementById("delivery-hint");
    hint.hidden = !isDelivery;
    hint.textContent = deliveryFeeNote;
  });
});

async function fetchReferralPercent(phone) {
  try {
    const res = await fetch(`/api/check-referral?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    return Number(data.percent) || 0;
  } catch (e) { return 0; }
}

// Buyurtmani serverga yuboradi. Narxlar serverda qayta hisoblanadi.
async function sendOrder(payment) {
  const p = pendingOrder;
  const body = p.isBulk
    ? { type: "bulk", customer: p.customer, bulk: p.bulk, payment }
    : {
        type: p.type,
        tableNumber: p.type === "table" ? tableNumber : undefined,
        customer: p.customer,
        items: cart.map((c) => ({ itemId: c.itemId, qty: c.qty })),
        referralPhone: p.referralPhone,
        payment,
      };
  return postJson("/api/create-order", body);
}

function finishOrder(data, extraText) {
  if (!pendingOrder.isBulk) { cart = []; saveCart(); renderCartBar(); }
  document.getElementById("confirm-order-code").textContent = data.code;
  document.getElementById("confirm-extra").textContent = extraText;
  document.getElementById("my-referral-code").textContent = pendingOrder.customer.phone;
  openDialog("confirm-modal");
}

document.getElementById("checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ensureOpen()) return;
  const submitBtn = e.submitter;
  if (submitBtn) submitBtn.disabled = true;

  try {
    const fd = new FormData(e.target);
    const phone = String(fd.get("phone")).trim();
    const subtotal = cartTotal();
    const percent = await fetchReferralPercent(phone);
    const total = subtotal - Math.round((subtotal * percent) / 100);

    pendingOrder = {
      isBulk: false,
      type: tableNumber ? "table" : fd.get("orderType"),
      customer: { name: String(fd.get("name")).trim(), phone, address: String(fd.get("address") || "").trim(), comment: String(fd.get("comment") || "").trim() },
      referralPhone: String(fd.get("referralPhone") || "").trim(),
      total,
    };
    closeDialog("checkout-modal");

    if (pendingOrder.type === "table") {
      try {
        const data = await sendOrder(undefined);
        finishOrder(data, "Buyurtmangiz oshxonaga tushdi. To'lovni stolda naqd yoki karta orqali qilasiz.");
      } catch (err) {
        alert(err.userFacing ? err.message : "Xatolik yuz berdi. Qaytadan urinib ko'ring yoki ofitsiantga ayting.");
        openDialog("checkout-modal");
      }
    } else {
      openPaymentStep(total, percent > 0 ? `To'lash kerak (${percent}% chegirma qo'llandi)` : "To'lash kerak");
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

/* ============ To'lov qadami ============ */
function openPaymentStep(amount, subLabel) {
  document.getElementById("pay-amount").textContent = formatSom(amount);
  document.getElementById("pay-sub-label").textContent = subLabel;
  document.getElementById("pay-card-number").textContent = SETTINGS.cardNumber || paymentConfig.cardNumber;
  document.getElementById("pay-card-holder").textContent = SETTINGS.cardHolder || paymentConfig.cardHolder;
  document.getElementById("payment-form").reset();
  document.getElementById("upload-status").textContent = "";
  openDialog("payment-modal");
}

async function uploadReceiptToImageKit(file) {
  const authRes = await fetch("/api/imagekit-auth");
  if (!authRes.ok) throw new Error("Yuklash uchun ruxsat olinmadi");
  const auth = await authRes.json();

  const fd = new FormData();
  fd.append("file", file);
  fd.append("fileName", `chek_${Date.now()}.jpg`);
  fd.append("publicKey", imagekitConfig.publicKey);
  fd.append("signature", auth.signature);
  fd.append("expire", auth.expire);
  fd.append("token", auth.token);
  fd.append("folder", "/anvar-joja-cheklar");

  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Rasm yuklanmadi");
  const data = await res.json();
  return data.url;
}

document.getElementById("payment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("submit-payment-btn");
  const statusEl = document.getElementById("upload-status");
  const fd = new FormData(e.target);
  const file = fd.get("receipt");
  const amountEntered = Number(fd.get("amountPaid"));

  if (!file || file.size === 0) { statusEl.textContent = "Chek rasmini tanlang."; return; }
  if (!file.type.startsWith("image/")) { statusEl.textContent = "Faqat rasm yuklash mumkin."; return; }
  if (file.size > 10 * 1024 * 1024) { statusEl.textContent = "Rasm hajmi 10 MB dan oshmasin."; return; }
  if (!(amountEntered > 0)) { statusEl.textContent = "To'langan summani kiriting."; return; }

  submitBtn.disabled = true;
  statusEl.textContent = "Yuborilmoqda…";

  try {
    const receiptUrl = await uploadReceiptToImageKit(file);
    const data = await sendOrder({ receiptUrl, amountEntered });
    closeDialog("payment-modal");
    finishOrder(data, "To'lovingiz tekshirilgach, buyurtmangiz qabul qilinadi. Kerak bo'lsa, Anvar aka siz bilan bog'lanadi.");
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.userFacing ? err.message : "Xatolik yuz berdi. Qaytadan urinib ko'ring yoki Anvar akaga to'g'ridan-to'g'ri yozing.";
  } finally {
    submitBtn.disabled = false;
  }
});

/* ============ Katta buyurtma / to'y ============ */
function kgPrice() {
  return MENU.find((m) => m.priceType === "kg" && m.category === "joja")?.price || 100000;
}

document.getElementById("bulk-banner").addEventListener("click", () => {
  const dateInput = document.getElementById("bulk-date");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  dateInput.min = iso;
  dateInput.value = iso;
  openDialog("bulk-modal");
});
document.querySelectorAll('input[name="bulkType"]').forEach((r) => {
  r.addEventListener("change", (e) => {
    const isDelivery = e.target.value === "delivery";
    document.getElementById("bulk-address-field").hidden = !isDelivery;
    document.getElementById("bulk-address-field").querySelector("textarea").required = isDelivery;
  });
});
document.querySelector('#bulk-form input[name="kg"]').addEventListener("input", (e) => {
  const kg = Number(e.target.value) || 0;
  const total = kg * kgPrice();
  document.getElementById("bulk-advance-hint").textContent =
    kg > 5 ? `Jami: ${formatSom(total)}. Hozir 50% avans: ${formatSom(Math.round(total / 2))}, qolgani olib ketish/yetkazishda to'lanadi.` : "";
});
document.getElementById("bulk-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const kg = Number(fd.get("kg"));
  if (!(kg > 5)) { alert("Katta buyurtma 5 kg dan ortiq bo'lishi kerak."); return; }
  const total = Math.round(kg * kgPrice());

  pendingOrder = {
    isBulk: true,
    customer: { name: String(fd.get("name")).trim(), phone: String(fd.get("phone")).trim(), address: String(fd.get("address") || "").trim(), comment: String(fd.get("comment") || "").trim() },
    bulk: { kg, date: fd.get("date"), type: fd.get("bulkType") },
    total,
  };
  closeDialog("bulk-modal");
  openPaymentStep(Math.round(total / 2), "Hozir to'lash kerak (50% avans)");
});

/* ============ Buyurtmalarim (tarix + qayta buyurtma + sharh) ============ */
document.getElementById("open-history-btn").addEventListener("click", () => openDialog("history-modal"));

document.getElementById("history-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const phone = new FormData(e.target).get("phone");
  const wrap = document.getElementById("history-results");
  wrap.innerHTML = `<p class="hint">Qidirilmoqda…</p>`;
  try {
    const { orders } = await postJson("/api/lookup-orders", { phone });
    if (!orders || orders.length === 0) { wrap.innerHTML = `<p class="hint">Bu raqam bilan buyurtma topilmadi.</p>`; return; }
    wrap.innerHTML = "";
    orders.forEach((order) => {
      const el = document.createElement("div");
      el.className = "order-history-card";
      const itemsText = order.type === "bulk" ? `${order.bulk?.kg || ""} kg jo'ja (${order.bulk?.date || ""})` : (order.items || []).map((i) => `${i.name} x${i.qty}`).join(", ");
      el.innerHTML = `
        <p class="code">${esc(order.code)}</p>
        <p class="meta">${esc(itemsText)}</p>
        <p class="meta">Jami: ${formatSom(order.total)} · ${esc(STATUS_LABELS[order.status] || order.status)}</p>
        <div class="history-actions"></div>`;
      const actions = el.querySelector(".history-actions");

      if (order.type !== "bulk" && order.items?.length) {
        const reorder = document.createElement("button");
        reorder.className = "reorder-btn";
        reorder.textContent = "Yana buyurtma qil";
        reorder.addEventListener("click", () => reorderItems(order));
        actions.appendChild(reorder);
      }
      if (order.status === "bajarildi") {
        const review = document.createElement("button");
        review.className = "reorder-btn";
        review.textContent = "Sharh qoldirish";
        review.addEventListener("click", () => {
          reviewContext = { orderId: order.id, customerName: order.customerName };
          closeDialog("history-modal");
          openDialog("review-modal");
        });
        actions.appendChild(review);
      }
      wrap.appendChild(el);
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<p class="hint">${esc(err.userFacing ? err.message : "Xatolik yuz berdi. Qaytadan urinib ko'ring.")}</p>`;
  }
});

// Eski buyurtmadagi taomlarni JORIY menyu narxlari bilan savatga qo'shadi
function reorderItems(order) {
  let missing = 0;
  order.items.forEach((i) => {
    const item = MENU.find((m) => m.id === i.itemId);
    if (item) addToCart(item, i.qty);
    else missing++;
  });
  closeDialog("history-modal");
  if (missing > 0) alert(`${missing} ta taom hozir menyuda yo'q, ular savatga qo'shilmadi.`);
  renderCartModal();
  openDialog("cart-modal");
}

/* ============ Sevimlilar ============ */
document.getElementById("open-favorites-btn").addEventListener("click", () => {
  const wrap = document.getElementById("favorites-list");
  const favItems = MENU.filter((m) => favorites.includes(m.id));
  if (favItems.length === 0) {
    wrap.innerHTML = `<p class="hint">Hali sevimli taom belgilamagansiz. Taomning yonidagi ❤ belgisini bosing.</p>`;
  } else {
    wrap.innerHTML = "";
    favItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "fav-row";
      row.innerHTML = `<span>${esc(item.name)}: ${formatSom(item.price)}</span>`;
      const btn = document.createElement("button");
      btn.className = "menu-item-add";
      btn.textContent = "+";
      btn.setAttribute("aria-label", "Savatga qo'shish");
      btn.addEventListener("click", () => addToCart(item));
      row.appendChild(btn);
      wrap.appendChild(row);
    });
  }
  openDialog("favorites-modal");
});

/* ============ Sharh ============ */
document.querySelectorAll("#star-rating span").forEach((star) => {
  star.addEventListener("click", () => {
    const rating = Number(star.dataset.star);
    document.querySelector('#review-form input[name="rating"]').value = rating;
    document.querySelectorAll("#star-rating span").forEach((s) => s.classList.toggle("active", Number(s.dataset.star) <= rating));
  });
});
document.getElementById("review-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!reviewContext) return;
  const fd = new FormData(e.target);
  try {
    await addDoc(collection(db, "reviews"), {
      orderId: String(reviewContext.orderId).slice(0, 40),
      rating: parseInt(fd.get("rating"), 10) || 5,
      text: String(fd.get("text") || "").trim().slice(0, 500),
      customerName: String(reviewContext.customerName || "Mijoz").slice(0, 60),
      approved: false,
      createdAt: serverTimestamp(),
    });
    e.target.reset();
    closeDialog("review-modal");
    alert("Rahmat! Sharhingiz tekshiruvdan so'ng saytda ko'rinadi.");
  } catch (err) {
    console.error(err);
    alert("Sharhni yuborib bo'lmadi. Keyinroq urinib ko'ring.");
  }
});

/* ============ Boshlash ============ */
(async function init() {
  renderCartBar();
  await loadSettings();
  await loadMenu();
  loadReviews();
  setInterval(renderOpenStatus, 60 * 1000);
})();
