// queues/calibrationQueue.js
const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({ maxRetriesPerRequest: null });

const calibrationQueue = new Queue("calibration-processing", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 4,
  },
});

module.exports = calibrationQueue;
