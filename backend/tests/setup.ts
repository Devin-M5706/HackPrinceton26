/**
 * Test environment.
 *
 * Set before any module imports `src/config`, which reads process.env once at
 * import time. Mock mode keeps tests offline: no database, no model provider,
 * no VMs.
 */

process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.LOG_LEVEL = 'error';
// No port is bound: supertest drives the app object directly.
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.ORCHESTRATOR_INTERNAL_SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
