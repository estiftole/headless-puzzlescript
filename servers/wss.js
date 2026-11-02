const WebSocket = require('ws');
const { Worker } = require('worker_threads');
const crypto = require('crypto');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

const WORKER_COUNT = 4;
const workers = [];
let nextWorkerIdx = 0;

for (let i = 0; i < WORKER_COUNT; i++) {
  const worker = new Worker('./workers/singleEnvWorker.js');
  workers.push(worker);
}

const sessionToClientWs = new Map();
const sessionToWorker = new Map();

workers.forEach((worker) => {
  worker.on('message', (message) => {
    const { sessionId, ...result } = message;
    const clientWs = sessionToClientWs.get(sessionId);

    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ sessionId, ...result }));
    }

    if (result.done) {
      sessionToClientWs.delete(sessionId);
      sessionToWorker.delete(sessionId);
    }
  });
});

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start_session') {
        const sessionId = crypto.randomUUID();
        sessionToClientWs.set(sessionId, ws);

        const worker = workers[nextWorkerIdx];
        sessionToWorker.set(sessionId, worker);
        nextWorkerIdx = (nextWorkerIdx + 1) % WORKER_COUNT;

        worker.postMessage({ sessionId, ...data });
      }
      else {
        const { sessionId } = data;
        const worker = sessionToWorker.get(sessionId);

        if (!worker) {
          ws.send(JSON.stringify({ error: "Session not found on server" }));
          return;
        }

        worker.postMessage(data);
      }
    } catch (err) {
      ws.send(JSON.stringify({ error: "Malformed payload" }));
    }
  });
});

console.log(`WebSocket Server running on ws://localhost:${PORT}`);
