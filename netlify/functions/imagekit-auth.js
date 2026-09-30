const crypto = require("crypto");

exports.handler = async function () {
  const token = crypto.randomBytes(16).toString("hex");
  const expire = Math.floor(Date.now() / 1000) + 60 * 10; // 10 daqiqa amal qiladi
  const signature = crypto
    .createHmac("sha1", process.env.IMAGEKIT_PRIVATE_KEY)
    .update(token + expire)
    .digest("hex");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, expire, signature }),
  };
};
