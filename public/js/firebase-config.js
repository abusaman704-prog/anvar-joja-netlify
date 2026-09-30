// Firebase loyihangizning sozlamalari (Firebase Console -> Project settings -> General -> Your apps)
export const firebaseConfig = {
  apiKey: "AIzaSyDGg04S6eFVLSv0Jiw4Xf36K-GxicPPts4",
  authDomain: "anvar-joja.firebaseapp.com",
  projectId: "anvar-joja",
  storageBucket: "anvar-joja.firebasestorage.app",
  messagingSenderId: "853910671939",
  appId: "1:853910671939:web:df398cb5c301678f053af6",
};

// ImageKit sozlamalari (rasm yuklash uchun). publicKey va urlEndpoint ImageKit
// Dashboard -> Developer options sahifasidan olinadi. Maxfiy (private) kalit
// bu yerga YOZILMAYDI — u faqat Netlify muhit o'zgaruvchisida (IMAGEKIT_PRIVATE_KEY) turadi.
export const imagekitConfig = {
  publicKey: "public_gId6wlELZsdtg01/zOswTz4Hwsw=",
  urlEndpoint: "https://ik.imagekit.io/4yrgobwbu",
};

// To'lov kartasi ma'lumotlari (saytda ko'rsatiladi)
export const paymentConfig = {
  cardNumber: "5614 6812 5965 5565",
  cardHolder: "Ikromov Roshan",
};

export const deliveryFeeNote =
  "Yetkazib berish narxi (Yandex kuryer) buyurtma summasiga kirmaydi — kuryer kelganda unga to'g'ridan-to'g'ri to'laysiz.";

