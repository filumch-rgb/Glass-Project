import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

interface Config {
  // Application
  nodeEnv: string;
  port: number;
  apiVersion: string;
  baseUrl: string;

  // Database
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    url: string;
  };

  // Security
  security: {
    jwtSecret: string;
    jwtExpiresIn: string;
    bcryptRounds: number;
    sessionSecret: string;
    forceHttps: boolean;
    sslCertPath?: string;
    sslKeyPath?: string;
  };

  // Storage
  storage: {
    provider: 'local' | 's3';
    localPath: string;
    maxSizeMB: number;
    aws?: {
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucketName: string;
      signedUrlExpires: number;
    };
  };

  // IMAP
  imap: {
    host: string;
    port: number;
    user: string;
    password: string;
    mailbox: string;
    completedFolder: string;
    failedFolder: string;
    pollIntervalMinutes: number;
  };

  // External APIs
  externalApis: {
    vinDecoder: {
      url?: string;
      apiKey?: string;
    };
    adasService: {
      url?: string;
      apiKey?: string;
    };
  };

  // Notifications
  notifications: {
    twilio: {
      accountSid?: string;
      authToken?: string;
      phoneNumber?: string;
    };
    whatsapp: {
      apiUrl?: string;
      apiToken?: string;
    };
  };

  // Assessment
  assessment: {
    confidenceThreshold: number;
    maxApiRetries: number;
    retryInitialDelayMs: number;
    journeyTokenExpiresHours: number;
    photoValidationTimeoutMinutes: number;
  };

  // Logging
  logging: {
    level: string;
    filePath: string;
    maxSize: string;
    maxFiles: number;
  };

  // Rate Limiting
  rateLimiting: {
    windowMs: number;
    maxRequests: number;
  };
}

const requiredEnvVars = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET',
  'SESSION_SECRET',
];

// Validate required environment variables
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Required environment variable ${envVar} is not set`);
  }
}

export const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiVersion: process.env.API_VERSION || 'v1',
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || '3000'}`,

  database: {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    url: process.env.DATABASE_URL!,
  },

  security: {
    jwtSecret: process.env.JWT_SECRET!,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    sessionSecret: process.env.SESSION_SECRET!,
    forceHttps: process.env.FORCE_HTTPS === 'true',
    ...(process.env.SSL_CERT_PATH && { sslCertPath: process.env.SSL_CERT_PATH }),
    ...(process.env.SSL_KEY_PATH && { sslKeyPath: process.env.SSL_KEY_PATH }),
  },

  storage: {
    provider: (process.env.STORAGE_PROVIDER as 'local' | 's3') || 'local',
    localPath: process.env.PHOTO_STORAGE_PATH || './uploads/photos',
    maxSizeMB: parseInt(process.env.PHOTO_MAX_SIZE_MB || '10', 10),
    ...(process.env.STORAGE_PROVIDER === 's3' && {
      aws: {
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        bucketName: process.env.S3_BUCKET_NAME || '',
        signedUrlExpires: parseInt(process.env.S3_SIGNED_URL_EXPIRES || '3600', 10),
      }
    }),
  },

  imap: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    user: process.env.IMAP_USER || '',
    password: process.env.IMAP_PASSWORD || '',
    mailbox: process.env.IMAP_MAILBOX || 'INBOX',
    completedFolder: process.env.IMAP_COMPLETED_FOLDER || 'Completed',
    failedFolder: process.env.IMAP_FAILED_FOLDER || 'Failed',
    pollIntervalMinutes: parseInt(process.env.IMAP_POLL_INTERVAL_MINUTES || '15', 10),
  },

  externalApis: {
    vinDecoder: {
      ...(process.env.VIN_DECODER_API_URL && { url: process.env.VIN_DECODER_API_URL }),
      ...(process.env.VIN_DECODER_API_KEY && { apiKey: process.env.VIN_DECODER_API_KEY }),
    },
    adasService: {
      ...(process.env.ADAS_SERVICE_API_URL && { url: process.env.ADAS_SERVICE_API_URL }),
      ...(process.env.ADAS_SERVICE_API_KEY && { apiKey: process.env.ADAS_SERVICE_API_KEY }),
    },
  },

  notifications: {
    twilio: {
      ...(process.env.TWILIO_ACCOUNT_SID && { accountSid: process.env.TWILIO_ACCOUNT_SID }),
      ...(process.env.TWILIO_AUTH_TOKEN && { authToken: process.env.TWILIO_AUTH_TOKEN }),
      ...(process.env.TWILIO_PHONE_NUMBER && { phoneNumber: process.env.TWILIO_PHONE_NUMBER }),
    },
    whatsapp: {
      ...(process.env.WHATSAPP_API_URL && { apiUrl: process.env.WHATSAPP_API_URL }),
      ...(process.env.WHATSAPP_API_TOKEN && { apiToken: process.env.WHATSAPP_API_TOKEN }),
    },
  },

  assessment: {
    confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7'),
    maxApiRetries: parseInt(process.env.MAX_API_RETRIES || '3', 10),
    retryInitialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || '1000', 10),
    journeyTokenExpiresHours: parseInt(process.env.JOURNEY_TOKEN_EXPIRES_HOURS || '24', 10),
    photoValidationTimeoutMinutes: parseInt(process.env.PHOTO_VALIDATION_TIMEOUT_MINUTES || '10', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: process.env.LOG_FILE_PATH || './logs/app.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '5', 10),
  },

  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
};

export default config;