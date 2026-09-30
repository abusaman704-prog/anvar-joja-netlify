const admin = require("firebase-admin");

function getFirebaseApp() {
  if (admin.apps.length > 0) return admin.app();

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

function getDb() {
  getFirebaseApp();
  return admin.firestore();
}

module.exports = { getDb, admin };
