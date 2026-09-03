// config/redisConnection.js
//
// Plain connection config object — used by BullMQ Workers/Queues,
// which require a plain { host, port } shape, NOT a live client instance.
// (redisClient.js wraps this same config in an actual ioredis instance
// for cache reads/writes — the two are kept separate on purpose.)

const redisConnection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
};

if (process.env.REDIS_PASSWORD) {
  redisConnection.password = process.env.REDIS_PASSWORD;
}

module.exports = redisConnection;