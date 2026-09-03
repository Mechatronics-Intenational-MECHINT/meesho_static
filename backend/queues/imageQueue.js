const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const imageQueue = new Queue("box-image-processing", {
  connection,

  defaultJobOptions: {
    attempts: 3,

    backoff: {
      type: "exponential",
      delay: 3000, // slightly higher for heavy S3 ops
    },

    removeOnComplete: {
      count: 1000,
    },

    removeOnFail: {
      count: 500,
    },
  },

  streams: {
    events: {
      maxLen: 1000,
    },
  },
});

module.exports = imageQueue;