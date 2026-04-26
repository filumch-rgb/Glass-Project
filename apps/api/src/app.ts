import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';

export async function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  await app.register(helmet);
  await app.register(cors, { origin: false });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Glass Claim Assessment API',
        version: '0.1.0'
      },
      tags: [{ name: 'system' }]
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            required: ['service', 'status'],
            properties: {
              service: { type: 'string' },
              status: { type: 'string' }
            }
          }
        }
      }
    },
    async () => ({
      service: 'glass-claim-assessment-api',
      status: 'ok'
    })
  );

  return app;
}
