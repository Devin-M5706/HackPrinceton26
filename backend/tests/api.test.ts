/**
 * End-to-end tests over the real Express app in mock mode.
 *
 * These are the regression tests for the access-control fixes: every case is a
 * request that used to be allowed and now must not be.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

const app = createApp();

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const validBody = {
  image_b64: PNG_1X1,
  child_meta: { age_months: 48, sex: 'male' },
};

describe('GET /api/health', () => {
  it('is public and reports status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mock_mode).toBe(true);
  });

  it('does not leak configuration values', async () => {
    const res = await request(app).get('/api/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('SUPABASE');
    expect(body).not.toMatch(/secret/i);
    // Machine IDs identify billable infrastructure; booleans only.
    expect(res.body.surveillance).not.toHaveProperty('machineId');
  });
});

describe('authentication', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/cases');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await request(app).get('/api/cases').set('Authorization', 'demo');
    expect(res.status).toBe(401);
  });

  it('rejects an arbitrary token even in mock mode', async () => {
    // Previously any token was accepted whenever Supabase was unconfigured,
    // which turned a credentials outage into an open API.
    const res = await request(app)
      .post('/api/screen')
      .set('Authorization', 'Bearer anything-at-all')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('accepts the demo token in mock mode', async () => {
    const res = await request(app)
      .post('/api/screen')
      .set('Authorization', 'Bearer demo')
      .send(validBody);
    expect(res.status).toBe(200);
  });
});

describe('internal endpoints', () => {
  it('refuses to start the surveillance VM without the shared secret', async () => {
    // This endpoint provisions billable infrastructure and was unauthenticated.
    const res = await request(app).post('/api/health/surveillance/start');
    expect(res.status).toBe(401);
  });

  it('refuses an incorrect shared secret', async () => {
    const res = await request(app)
      .post('/api/health/surveillance/start')
      .set('x-internal-secret', 'wrong');
    expect(res.status).toBe(401);
  });

  it('refuses to dispatch an alert without the shared secret', async () => {
    const res = await request(app).post('/api/health/notify').send({
      region: 'zinder',
      case_count: 5,
      radius_km: 10,
      center_lat: 13.8,
      center_lng: 8.99,
    });
    expect(res.status).toBe(401);
  });

  it('validates the alert payload once authenticated', async () => {
    const res = await request(app)
      .post('/api/health/notify')
      .set('x-internal-secret', process.env.ORCHESTRATOR_INTERNAL_SECRET!)
      .send({ region: 'zinder', case_count: 'lots' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/screen', () => {
  const auth = { Authorization: 'Bearer demo' };

  it('rejects a body with no image', async () => {
    const res = await request(app)
      .post('/api/screen')
      .set(auth)
      .send({ child_meta: validBody.child_meta });
    expect(res.status).toBe(400);
  });

  it('rejects bytes that are not a supported image', async () => {
    const res = await request(app)
      .post('/api/screen')
      .set(auth)
      .send({ ...validBody, image_b64: Buffer.from('nope').toString('base64') });
    expect(res.status).toBe(400);
  });

  it('labels mock results so they cannot be mistaken for a diagnosis', async () => {
    const res = await request(app).post('/api/screen').set(auth).send(validBody);
    expect(res.body.mock).toBe(true);
    expect(res.body.clinical_note).toMatch(/demonstration/i);
  });

  it('reports whether the case was persisted', async () => {
    const res = await request(app).post('/api/screen').set(auth).send(validBody);
    expect(res.body).toHaveProperty('persisted');
    expect(res.body).toHaveProperty('degraded');
  });
});

describe('error handling', () => {
  it('returns 404 with a code for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('returns 400 for malformed JSON rather than hanging', async () => {
    const res = await request(app)
      .post('/api/screen')
      .set('Authorization', 'Bearer demo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
  });
});
