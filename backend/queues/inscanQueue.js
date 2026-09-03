const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const inscanQueue = new Queue("process-inscan", {
  connection,

  defaultJobOptions: {
    attempts: 3,

    backoff: {
      type: "exponential",
      delay: 2000,
    },

    removeOnComplete: {
      count: 1000, // keep last 1000 completed jobs
    },

    removeOnFail: {
      count: 500, // keep last 500 failed jobs
    },
  },

  // 🔥 LIMIT REDIS EVENT STREAM SIZE
  streams: {
    events: {
      maxLen: 1000, // prevents Redis memory overflow
    },
  },
});

module.exports = inscanQueue;