// Loaded before every test file. Deterministic so global setup and tests agree.
export const TEST_DB_PORT = 54330;
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/edimart_test`;
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.PUBLIC_API_URL = "http://127.0.0.1:4000";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.UPLOAD_DIR = require("path").join(require("os").tmpdir(), "edimart-test-uploads");
process.env.NODE_ENV = "test";
process.env.LOGIN_RATE_LIMIT = "100000";
