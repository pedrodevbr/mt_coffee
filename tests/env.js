// Loaded by Jest before each test file (see "setupFiles" in package.json).
// Ensures the test env file is loaded before any module is required.
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: '.env.test' });
