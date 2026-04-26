import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp({
  logger: {
    redact: ['req.headers.authorization', 'req.headers.cookie']
  }
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error({ err: error }, 'API failed to start');
  process.exit(1);
}
