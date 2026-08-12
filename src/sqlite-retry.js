const SQLITE_BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);

const sleep = (ms) => {
  if (ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
};

export function isSqliteBusy(error) {
  return SQLITE_BUSY_CODES.has(error?.code);
}

export function withSqliteRetry(operation, {
  retries = 7,
  initialDelayMs = 5,
  maxDelayMs = 320,
} = {}) {
  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusy(error) || attempt >= retries) throw error;
      sleep(delay);
      attempt++;
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}
