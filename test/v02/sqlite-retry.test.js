import test from 'node:test';
import assert from 'node:assert/strict';
import { isSqliteBusy, withSqliteRetry } from '../../src/sqlite-retry.js';

test('SQLite retry retries SQLITE_BUSY and eventually succeeds', () => {
  let attempts = 0;
  const result = withSqliteRetry(() => {
    attempts++;
    if (attempts < 3) {
      const error = new Error('busy');
      error.code = 'SQLITE_BUSY';
      throw error;
    }
    return 'ok';
  }, { initialDelayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('SQLite retry also handles SQLITE_LOCKED', () => {
  let attempts = 0;
  const result = withSqliteRetry(() => {
    attempts++;
    if (attempts === 1) {
      const error = new Error('locked');
      error.code = 'SQLITE_LOCKED';
      throw error;
    }
    return 42;
  }, { initialDelayMs: 0 });

  assert.equal(result, 42);
  assert.equal(attempts, 2);
});

test('SQLite retry does not retry unrelated errors', () => {
  let attempts = 0;
  assert.throws(() => withSqliteRetry(() => {
    attempts++;
    throw new Error('validation failed');
  }, { initialDelayMs: 0 }), /validation failed/);
  assert.equal(attempts, 1);
});

test('SQLite retry stops after the configured retry count', () => {
  let attempts = 0;
  assert.throws(() => withSqliteRetry(() => {
    attempts++;
    const error = new Error('busy');
    error.code = 'SQLITE_BUSY';
    throw error;
  }, { retries: 2, initialDelayMs: 0 }), error => error.code === 'SQLITE_BUSY');
  assert.equal(attempts, 3);
});

test('SQLite busy detection only matches SQLite lock errors', () => {
  assert.equal(isSqliteBusy({ code: 'SQLITE_BUSY' }), true);
  assert.equal(isSqliteBusy({ code: 'SQLITE_LOCKED' }), true);
  assert.equal(isSqliteBusy({ code: 'SQLITE_CONSTRAINT' }), false);
  assert.equal(isSqliteBusy(new Error('busy')), false);
});
