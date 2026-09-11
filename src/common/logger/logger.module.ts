import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

const isProduction = process.env.NODE_ENV === 'production';

// ──────────────────────────────────────
//  Custom Formats
// ──────────────────────────────────────
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, context, stack }) => {
    const formatValue = (val: unknown): string => {
      if (val === undefined || val === null) return '';
      if (typeof val === 'string') return val;
      if (typeof val === 'number' || typeof val === 'boolean') return `${val}`;
      // Safely stringify objects, functions, or symbols
      return JSON.stringify(val);
    };

    const formattedTs = formatValue(timestamp);
    const formattedLvl = formatValue(level);
    const formattedCtx = formatValue(context);
    const formattedMsg = formatValue(message);
    const formattedTrace = formatValue(stack);

    const ctx = formattedCtx ? `[${formattedCtx}]` : '';
    const trace = formattedTrace ? `\n${formattedTrace}` : '';

    return `${formattedTs}  ${formattedLvl}  ${ctx}  ${formattedMsg}${trace}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ──────────────────────────────────────
//  Transports
// ──────────────────────────────────────

const consoleTransport = new winston.transports.Console({
  format: isProduction ? prodFormat : devFormat,
});

const allLogsRotate = new winston.transports.DailyRotateFile({
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: prodFormat,
});

const errorLogsRotate = new winston.transports.DailyRotateFile({
  filename: 'logs/error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: prodFormat,
});

// ──────────────────────────────────────
//  Module
// ──────────────────────────────────────

@Module({
  imports: [
    WinstonModule.forRoot({
      level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
      transports: [consoleTransport, allLogsRotate, errorLogsRotate],
      // Handle uncaught exceptions & rejections
      exceptionHandlers: [
        new winston.transports.File({ filename: 'logs/exceptions.log' }),
      ],
      rejectionHandlers: [
        new winston.transports.File({ filename: 'logs/rejections.log' }),
      ],
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
