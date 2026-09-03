// config/redisClient.js
const Redis = require("ioredis");
const redisConnection = require("./redisConnection");

const redisClient = new Redis(redisConnection);

redisClient.on("error", (err) => {
  console.error("❌ redisClient error:", err.message);
});

module.exports = redisClient;