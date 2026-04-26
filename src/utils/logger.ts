import winston from 'winston';
import path from 'path';
import { config } from '../config';

// PII-safe formatter that redacts sensitive information
const piiSafeFormatter = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  // Ensure message is a string
  const messageStr = typeof message === 'string' ? message : String(message);
  
  // Redact common PII patterns
  const redactedMessage = messageStr
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
    .replace(/\b\d{3}-\d{3}-\d{4}\b/g, '[PHONE_REDACTED]')
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, '[CARD_REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
    .replace(/\b[A-Z0-9]{17}\b/g, '[VIN_REDACTED]')
    .replace(/"password":\s*"[^"]*"/gi, '"password": "[REDACTED]"')
    .replace(/"token":\s*"[^"]*"/gi, '"token": "[REDACTED]"')
    .replace(/"secret":\s*"[^"]*"/gi, '"secret": "[REDACTED]"')
    .replace(/"key":\s*"[^"]*"/gi, '"key": "[REDACTED]"');

  // Redact meta object PII
  const redactedMeta = JSON.stringify(meta, (key, value) => {
    if (typeof value === 'string') {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || 
          lowerKey.includes('token') || 
          lowerKey.includes('secret') || 
          lowerKey.includes('key') ||
          lowerKey.includes('email') ||
          lowerKey.includes('phone') ||
          lowerKey.includes('mobile')) {
        return '[REDACTED]';
      }
      // Apply same PII redaction to string values
      return value
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
        .replace(/\b\d{3}-\d{3}-\d{4}\b/g, '[PHONE_REDACTED]')
        .replace(/\b[A-Z0-9]{17}\b/g, '[VIN_REDACTED]');
    }
    return value;
  });

  const metaStr = Object.keys(meta).length > 0 ? ` ${redactedMeta}` : '';
  return `${timestamp} [${level.toUpperCase()}]: ${redactedMessage}${metaStr}`;
});

// Create logs directory if it doesn't exist
const logDir = path.dirname(config.logging.filePath);

// Configure winston logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    piiSafeFormatter
  ),
  transports: [
    // File transport
    new winston.transports.File({
      filename: config.logging.filePath,
      maxsize: parseInt(config.logging.maxSize.replace('m', '')) * 1024 * 1024, // Convert MB to bytes
      maxFiles: config.logging.maxFiles,
      tailable: true,
    }),
    // Error file transport
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: parseInt(config.logging.maxSize.replace('m', '')) * 1024 * 1024,
      maxFiles: config.logging.maxFiles,
      tailable: true,
    }),
  ],
});

// Add console transport in development
if (config.nodeEnv === 'development') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      piiSafeFormatter
    )
  }));
}

// Helper functions for structured logging
export const loggers = {
  // System events
  system: {
    startup: (port: number) => logger.info(`Server started on port ${port}`),
    shutdown: () => logger.info('Server shutting down'),
    dbConnected: () => logger.info('Database connected successfully'),
    dbDisconnected: () => logger.info('Database disconnected'),
    dbError: (error: Error) => logger.error('Database error', { error: error.message, stack: error.stack }),
  },

  // Claim lifecycle events
  claim: {
    intakeReceived: (claimId: string, insurerId: string) => 
      logger.info('Claim intake received', { claimId, insurerId }),
    intakeFailed: (messageId: string, errors: string[]) => 
      logger.warn('Claim intake failed', { messageId, errors }),
    statusTransition: (claimId: string, fromStatus: string, toStatus: string) => 
      logger.info('Claim status transition', { claimId, fromStatus, toStatus }),
    decisionGenerated: (claimId: string, decision: string, confidence: number) => 
      logger.info('Decision generated', { claimId, decision, confidence }),
    manualReviewTriggered: (claimId: string, reasons: string[]) => 
      logger.info('Manual review triggered', { claimId, reasons }),
  },

  // Security events
  security: {
    authSuccess: (userId: string, ip: string) => 
      logger.info('Authentication successful', { userId, ip }),
    authFailure: (attempt: string, ip: string) => 
      logger.warn('Authentication failed', { attempt, ip }),
    tokenExpired: (userId: string) => 
      logger.info('Token expired', { userId }),
    rateLimitExceeded: (ip: string, endpoint: string) => 
      logger.warn('Rate limit exceeded', { ip, endpoint }),
    suspiciousActivity: (details: Record<string, unknown>) => 
      logger.warn('Suspicious activity detected', details),
  },

  // API events
  api: {
    request: (method: string, url: string, ip: string, userAgent?: string) => 
      logger.info('API request', { method, url, ip, userAgent }),
    response: (method: string, url: string, statusCode: number, duration: number) => 
      logger.info('API response', { method, url, statusCode, duration }),
    error: (method: string, url: string, error: Error) => 
      logger.error('API error', { method, url, error: error.message, stack: error.stack }),
    externalApiCall: (service: string, endpoint: string, duration: number, success: boolean) => 
      logger.info('External API call', { service, endpoint, duration, success }),
  },

  // Photo processing events
  photo: {
    uploaded: (claimId: string, slot: string, fileSize: number) => 
      logger.info('Photo uploaded', { claimId, slot, fileSize }),
    validated: (claimId: string, slot: string, outcome: string) => 
      logger.info('Photo validated', { claimId, slot, outcome }),
    rejected: (claimId: string, slot: string, reason: string) => 
      logger.info('Photo rejected', { claimId, slot, reason }),
  },

  // General application events
  app: {
    info: (message: string, meta?: Record<string, unknown>) => logger.info(message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => logger.warn(message, meta),
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => 
      logger.error(message, { ...meta, error: error?.message, stack: error?.stack }),
    debug: (message: string, meta?: Record<string, unknown>) => logger.debug(message, meta),
  },
};

export default logger;