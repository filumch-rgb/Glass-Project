import { Request, Response, NextFunction } from 'express';
import { loggers } from '../utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Generate request ID
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.headers['x-request-id'] = requestId;

  // Log incoming request
  loggers.api.request(
    req.method,
    req.originalUrl,
    req.ip || 'unknown',
    req.get('User-Agent')
  );

  // Override res.end to log response
  const originalEnd = res.end.bind(res);
  (res.end as any) = (chunk?: any, encoding?: any, cb?: any) => {
    const duration = Date.now() - startTime;
    
    loggers.api.response(
      req.method,
      req.originalUrl,
      res.statusCode,
      duration
    );

    // Call original end method
    return originalEnd(chunk, encoding, cb);
  };

  next();
};