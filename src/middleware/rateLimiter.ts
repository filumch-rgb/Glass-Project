import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { loggers } from '../utils/logger';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

class RateLimiter {
  private store: RateLimitStore = {};
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Clean up expired entries every minute
    setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    Object.keys(this.store).forEach(key => {
      const entry = this.store[key];
      if (entry && entry.resetTime < now) {
        delete this.store[key];
      }
    });
  }

  private getKey(req: Request): string {
    // Use IP address as the key, but could be enhanced with user ID for authenticated requests
    return req.ip || 'unknown';
  }

  public middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = this.getKey(req);
    const now = Date.now();

    // Initialize or reset if window has passed
    if (!this.store[key] || this.store[key].resetTime < now) {
      this.store[key] = {
        count: 0,
        resetTime: now + this.windowMs
      };
    }

    // Increment request count
    this.store[key].count++;

    // Set rate limit headers
    const remaining = Math.max(0, this.maxRequests - this.store[key].count);
    const resetTime = Math.ceil(this.store[key].resetTime / 1000);

    res.set({
      'X-RateLimit-Limit': this.maxRequests.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': resetTime.toString(),
    });

    // Check if limit exceeded
    if (this.store[key].count > this.maxRequests) {
      loggers.security.rateLimitExceeded(req.ip || 'unknown', req.originalUrl);
      
      res.status(429).json({
        error: {
          message: 'Too Many Requests',
          statusCode: 429,
          retryAfter: Math.ceil((this.store[key].resetTime - now) / 1000),
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    next();
  };
}

// Create rate limiter instance
const rateLimiterInstance = new RateLimiter(
  config.rateLimiting.windowMs,
  config.rateLimiting.maxRequests
);

export const rateLimiter = rateLimiterInstance.middleware;