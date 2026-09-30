# Anvar Joja — Netlify versiyasi (v3)

Firebase (baza va kirish) + Netlify (sayt va bot) + ImageKit (rasmlar).

## Nimalar bor

- **Mijoz sayti:** menyu, savat, olib ketish, yetkazish, stol (QR), 5 kg dan katta buyurtma (50% avans), chek yuklash, buyurtma tarixi, qayta buyurtma, sevimlilar, sharh, do'stni taklif qilish (5% chegirma)
- **Admin panel:** 3 rol (Super Admin, Boshliq/Oshpaz, Ofitsiant), menyu (rasm yuklash bilan), sharhlarni tasdiqlash, statistika, CSV, sozlamalar, QR-kod yaratish, xodimlarni boshqarish, amallar tarixi
- **Telegram bot:** yangi buyurtma xabari va tugmalar (to'lovni tasdiqlash, holatni o'zgartirish), mijozlar uchun `/start`, `/menu`, `/id`

## Xavfsizlik (muhim)

- Buyurtmalar **faqat server orqali** yaratiladi. Narxlar serverda menyudan qayta hisoblanadi, mijoz yuborgan narxga ishonilmaydi.
- Buyurtmalarni faqat xodimlar o'qiy oladi. Buyurtma tarixida mijozga faqat taomlar, holat va summa ko'rinadi (manzil, izoh va chek ko'rinmaydi).
- Bot tugmalari faqat sizning xodim chatlaringizdan ishlaydi va maxfiy kalit (`TELEGRAM_WEBHOOK_SECRET`) talab qilinadi.
- Ofitsiant to'lovni tasdiqlay olmaydi va buyurtmani bekor qila olmaydi (bu qoida serverda ham tekshiriladi).
- Qolgan xavf: buyurtma tarixini telefon raqamini bilgan odam ko'ra oladi (taomlar va holat). Bu funksiya qulaylik uchun shunday qoldirilgan.

---

## 1. Firebase

Firebase loyihangiz tayyor (`anvar-joja`). `public/js/firebase-config.js` ichida `firebaseConfig` allaqachon to'ldirilgan.

### Firestore qoidalarini joylash (MAJBURIY, yangi qoidalar)
1. Firebase Console → Firestore Database → **Rules**.
2. `firestore.rules` faylining matnini to'liq nusxalab joylashtiring → **Publish**.

### Birinchi Super Admin
1. Authentication → Users → **Add user** (o'z email va parolingiz). UID'ni nusxalang.
2. Firestore → **Start collection** `users` → Document ID = shu UID → maydonlar: `role` (string) = `super_admin`, `name` (string) = ismingiz.

Boshqa xodimlarni admin paneldan qo'shasiz (Firebase Console kerak emas).

---

## 2. ImageKit (rasmlar va cheklar)

1. imagekit.io → Dashboard → **Developer options**.
2. **Public key** va **URL-endpoint**ni `public/js/firebase-config.js` dagi `imagekitConfig`ga yozing.
3. **Private key**ni faqat Netlify environment variable sifatida kiritasiz (5-qadam). Uni faylga yozmang.

---

## 3. Telegram bot

Bot tayyor (@Anvar_joja_bot). Chat ID kerak bo'ladi:
- O'zingizning ID: botga `/start` yozing, bot ID'ni o'zi aytadi (yoki `/id`).
- Ofitsiant/Anvar aka ham buyurtma xabarlarini olsin desangiz: ular botga `/id` yozib o'z ID'sini yuborsin va ID'larni vergul bilan yozing: `123456789,987654321`.

---

## 4. GitHub va Netlify

1. GitHub'da yangi repository (masalan `anvar-joja-netlify`), ZIP'ni oching va ichidagi hamma narsani yuklang. **Xizmat hisobi JSON faylini yuklamang.**
2. Netlify'da (yangi akkaunt) **Add new site → Import an existing project → GitHub** → repository → **Deploy**. Sozlamalar `netlify.toml`dan o'qiladi.

## 5. Environment variables

Netlify → Site configuration → Environment variables:

| Nomi | Qiymati |
|---|---|
| `FIREBASE_PROJECT_ID` | `anvar-joja` |
| `FIREBASE_CLIENT_EMAIL` | xizmat hisobi JSON faylidagi `client_email` |
| `FIREBASE_PRIVATE_KEY` | JSON faylidagi `private_key` (butun matn, `\n` belgilari bilan) |
| `TELEGRAM_BOT_TOKEN` | BotFather tokeni |
| `TELEGRAM_CHAT_ID` | xodim chat ID'lari (vergul bilan) |
| `TELEGRAM_WEBHOOK_SECRET` | o'zingiz o'ylab topgan uzun tasodifiy matn (harf va raqam) |
| `IMAGEKIT_PRIVATE_KEY` | ImageKit private key |

Keyin **Deploys → Trigger deploy → Deploy site**.

## 6. Telegram webhook

Brauzerda (qiymatlarni almashtirib):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://SAYT-MANZILI/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

`"ok":true` chiqishi kerak.

## 7. Birinchi ishga tushirish

1. `https://SAYT-MANZILI/admin/` ga Super Admin sifatida kiring.
2. **Menyu** → **Tayyor menyuni yuklash (15 ta taom)** tugmasi (menyu bo'sh bo'lsa ko'rinadi).
3. Har bir taomni bosib rasm yuklang, narxlarni tekshiring.
4. **Sozlamalar**: karta raqami, telefon, Instagram, xarita havolasi, ish vaqti, aksiya matni.
5. **QR-stollar**: stollar sonini kiriting → **QR-kodlarni yaratish** → **Chop etish**.
6. **Xodimlar**: Anvar aka (Boshliq / Oshpaz) va yordamchi (Ofitsiant) uchun login yarating.

---

## 8. Sinov ro'yxati

- [ ] Bosh sahifada menyu ko'rinadi, rasmlar chiqadi
- [ ] Olib ketish buyurtmasi: chek yuklash, Telegramga xabar keladi (chek havolasi bilan)
- [ ] Botda "To'lovni tasdiqlash" bosilganda xabar yangilanadi, admin panelda holat o'zgaradi
- [ ] Yetkazish: manzil so'raladi; "Yetkazilmoqda" holati bor
- [ ] `/table/1` ochilganda "1-stoldasiz" banneri chiqadi, to'lov so'ralmaydi, buyurtma botga tushadi
- [ ] Katta buyurtma: 5 kg dan kam qabul qilinmaydi, avans 50% ko'rsatiladi
- [ ] Yopiq vaqtda oddiy buyurtma berib bo'lmaydi (ish vaqtidan tashqarida)
- [ ] Ofitsiant sifatida kiring: faqat "Buyurtmalar", to'lovni tasdiqlash va bekor qilish tugmalari yo'q
- [ ] Boshliq sifatida kiring: menyu, sharh, statistika, sozlamalar, QR bor; Xodimlar va Tarix yo'q
- [ ] Sharh: buyurtma "Bajarildi" bo'lgach "Buyurtmalarim"dan sharh yozing, panelda tasdiqlang, saytda ko'rinadi
- [ ] Taklif: A mijoz kodi (telefoni) bilan B buyurtma beradi; B "Bajarildi" bo'lgach A keyingi buyurtmada 5% chegirma oladi
- [ ] Botga `/start` va `/menu` yozing
- [ ] Netlify → Logs → Functions bo'limida xatolar yo'qligini tekshiring

## Eslatmalar

- Yandex kuryer qo'lda chaqiriladi; yo'l haqini mijoz kuryerga to'g'ridan-to'g'ri to'laydi.
- Buyurtma kodlari kun bo'yicha ketma-ket: `AJ-YYMMDD-001`, `-002`...
- `.uz` domenni keyin Netlify → Domain management orqali ulaysiz.
