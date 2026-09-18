import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup-app.js';

describe('API bootstrap (e2e)', () => {
  let app: INestApplication<App>;
  const frontendOrigin = 'http://localhost:3000';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ FRONTEND_ORIGIN: frontendOrigin }))
      .compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the health endpoint with the API prefix', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect('Content-Type', /json/)
      .expect(200, { status: 'ok' });
  });

  it('does not expose the endpoint outside the API prefix', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('supports frontend CORS preflight requests', async () => {
    await request(app.getHttpServer())
      .options('/api/health')
      .set('Origin', frontendOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', frontendOrigin)
      .expect(204);
  });
});
