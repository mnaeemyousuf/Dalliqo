// Runs before any module is imported, so src/config/env.ts sees these values.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/recrm_test';
process.env.JWT_SECRET = 'test-access-secret-0123456789-abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-abcdefghijklmno';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.APP_WEB_URL = 'http://localhost:5173';
process.env.SMTP_HOST = '';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), `recrm-test-uploads-${process.pid}`);
process.env.STORAGE_DRIVER = 'local';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:4000';
process.env.JOBS_ENABLED = 'false';
