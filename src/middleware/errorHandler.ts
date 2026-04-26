import { Request, Response, NextFunction } from 'express';
import { loggers } from '../utils/logger';
import { config } from '../config';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Default error values
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal Server Error';
  let isOperational = error.isOperational || false;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    isOperational = true;
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
    isOperational = true;
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    isOperational = true;
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    isOperational = true;
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    isOperational = true;
  }

  // Log error
  if (statusCode >= 500) {
    loggers.api.error(req.method, req.originalUrl, error);
  } else {
    loggers.app.warn(`${statusCode} error on ${req.method} ${req.originalUrl}`, {
      error: message,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  }

  // Prepare error response
  const errorResponse: any = {
    error: {
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method
    }
  };

  // Include stack trace in development
  if (config.nodeEnv === 'development') {
    errorResponse.error.stack = error.stack;
  }

  // Include request ID if available
  if (req.headers['x-request-id']) {
    errorResponse.error.requestId = req.headers['x-request-id'];
  }

  res.status(statusCode).json(errorResponse);
};