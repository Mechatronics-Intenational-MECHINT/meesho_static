const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const fs = require("fs");

// 🔥 Store logs outside project (D drive)
const logDir = "D:/logs";

// ✅ Ensure folder exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 🎯 Common format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss"
  }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// 🚀 Logger
const logger = winston.createLogger({
  level: "info", // logs: info, warn, error (debug if needed)

  format: logFormat,

  transports: [
    // 🔥 SINGLE COMBINED FILE
    new DailyRotateFile({
      filename: `${logDir}/app-%DATE%.log`,
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",     // rotate if file > 20MB
      maxFiles: "7d",     // keep logs for 7 days
    }),

    // (Optional) Console
    // new winston.transports.Console({
    //   format: winston.format.combine(
    //     winston.format.colorize(),
    //     logFormat
    //   ),
    // }),
  ],
});

module.exports = logger;