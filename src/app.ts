import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { loggers } from './utils/logger';
import database from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { rateLimiter } from './middleware/rateLimiter';
import claimSubmissionRouter from './routes/claimSubmission';
import consentRouter from './routes/consent';
import photosRouter from './routes/photos';

class App {
  public app: express.Application;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for form
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.nodeEnv === 'production' 
        ? ['https://yourdomain.com'] // Replace with actual production domains
        : true, // Allow all origins in development
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Rate limiting
    this.app.use(rateLimiter);

    // Request parsing
    this.app.use(express.json({ limit: '10mb' })); // For photo uploads
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use(requestLogger);

    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Force HTTPS in production
    if (config.security.forceHttps && config.nodeEnv === 'production') {
      this.app.use((req, res, next) => {
        if (req.header('x-forwarded-proto') !== 'https') {
          res.redirect(`https://${req.header('host')}${req.url}`);
        } else {
          next();
        }
      });
    }
  }

  private initializeRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const dbConnected = await database.testConnection();
        const dbStats = await database.getStats();
        
        const health = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: config.apiVersion,
          environment: config.nodeEnv,
          database: {
            connected: dbConnected,
            stats: dbStats
          },
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        };

        res.status(200).json(health);
      } catch (error) {
        loggers.app.error('Health check failed', error as Error);
        res.status(503).json({
          status: 'error',
          timestamp: new Date().toISOString(),
          message: 'Service unavailable'
        });
      }
    });

    // API version info
    this.app.get(`/api/${config.apiVersion}`, (req, res) => {
      res.json({
        name: 'Glass Claim Assessment System',
        version: config.apiVersion,
        description: 'Phase 1 Pilot - Windscreen Claims Processing',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          api: `/api/${config.apiVersion}`,
          // Additional endpoints will be added as we implement them
        }
      });
    });

    // Placeholder routes for future implementation
    const apiRouter = express.Router();
    
    // Intake routes (Task 3)
    apiRouter.get('/claims', (req, res) => {
      res.status(501).json({ message: 'Claims endpoint - Coming in Task 3' });
    });

    // Journey routes (Task 4)
    apiRouter.post('/journey', (req, res) => {
      res.status(501).json({ message: 'Journey endpoint - Coming in Task 4' });
    });

    // Photo upload routes (Task 6)
    apiRouter.post('/photos', (req, res) => {
      res.status(501).json({ message: 'Photo upload endpoint - Coming in Task 6' });
    });

    // Manual review routes (Task 10)
    apiRouter.get('/reviews', (req, res) => {
      res.status(501).json({ message: 'Manual review endpoint - Coming in Task 10' });
    });

    this.app.use(`/api/${config.apiVersion}`, apiRouter);
    
    // Claim submission route (web form) - mounted directly on /api
    this.app.use('/api', claimSubmissionRouter);

    // Consent routes - mounted directly on /api
    this.app.use('/api', consentRouter);

    // Photo routes - mounted directly on /api
    this.app.use('/api', photosRouter);

    // Journey page route - serve journey.html for /journey/:token
    this.app.get('/journey/:token', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/journey.html'));
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });
  }

  private initializeErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    try {
      // Test database connection
      const dbConnected = await database.testConnection();
      if (!dbConnected) {
        throw new Error('Database connection failed');
      }

      // Check if required tables exist
      const tablesExist = await database.checkTablesExist();
      if (!tablesExist) {
        loggers.app.warn('Some database tables are missing. Run migrations to create them.');
      }

      // Start server
      this.app.listen(config.port, () => {
        loggers.system.startup(config.port);
        loggers.app.info('Glass Claim Assessment System started', {
          version: config.apiVersion,
          environment: config.nodeEnv,
          port: config.port,
          database: config.database.name,
          tablesExist
        });
      });

    } catch (error) {
      loggers.app.error('Failed to start application', error as Error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    try {
      await database.close();
      loggers.system.shutdown();
    } catch (error) {
      loggers.app.error('Error during shutdown', error as Error);
    }
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  loggers.app.info('SIGTERM received, shutting down gracefully');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  loggers.app.info('SIGINT received, shutting down gracefully');
  await app.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  loggers.app.error('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  loggers.app.error('Unhandled rejection', new Error(String(reason)), { promise });
  process.exit(1);
});

const app = new App();

// Start the application
if (require.main === module) {
  app.start();
}

export default app;