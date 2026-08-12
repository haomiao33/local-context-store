import { parentPort, workerData } from 'node:worker_threads';
import { createStore } from './store.js';

const terms = [
  'authentication', 'authorization', 'refresh', 'token', 'session', 'race',
  'concurrency', 'zustand', 'api', 'database', 'cache', 'request', 'retry',
  'middleware', 'webhook', 'payment', 'checkout', 'frontend', 'backend'
];

function randomText(size = 8) {
  const words = [];
  for (let i = 0; i < size; i++) {
    words.push(terms[Math.floor(Math.random() * terms.length)]);
  }
  return words.join(' ');
}

if (!parentPort || !workerData) {
  throw new Error('concurrency worker must be started by node:worker_threads');
}

const store = createStore(workerData.projectDir);
try {
  for (let i = 0; i < workerData.writes; i++) {
    store.remember({
      projectId: workerData.projectId,
      type: i % 2 ? 'observation' : 'note',
      content: `${randomText()} worker-${workerData.workerId} item-${i}`,
      importance: Math.random(),
    });
  }
  for (let i = 0; i < workerData.searches; i++) {
    store.search({
      projectId: workerData.projectId,
      query: randomText(3),
      limit: 10,
    });
  }
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.stack });
} finally {
  store.close();
}
