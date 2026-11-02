const { Worker } = require('worker_threads');
const { parseArgs } = require('node:util');
const crypto = require('crypto');
const net = require('net');

const { values } = parseArgs({
  options: {
    parallel: { type: 'boolean', short: 'p' },
    single: { type: 'boolean', short: 's' }
  }
});

let envMode = 'singleEnvWorker';
if (values.parallel) {
  envMode = 'parallelEnvWorker';
} else if (values.single) {
  envMode = 'singleEnvWorker';
}

const PORT = 8080;
const WORKER_COUNT = 4;

const workers = [];
let nextWorkerIdx = 0;

const sessionToSocket = new Map();
const sessionToWorker = new Map();

for (let i = 0; i < WORKER_COUNT; i++) {
  const worker = new Worker(`./workers/${envMode}.js`);
  workers.push(worker);
}

workers.forEach((worker) => {
  worker.on('message', (message) => {
    const { sessionId, error, ...result } = message;
    const clientSocket = sessionToSocket.get(sessionId);

    if (clientSocket && !clientSocket.destroyed) {
      clientSocket.write(JSON.stringify({ sessionId, error, ...result }) + '\n');
    }

    if (result.done || error) {
      sessionToSocket.delete(sessionId);
      sessionToWorker.delete(sessionId);
    }
  });
});

const server = net.createServer((socket) => {
  socket.setNoDelay(true);

  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let boundary = buffer.indexOf('\n');

    while (boundary !== -1) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf('\n');

      if (!line) continue;

      try {
        const data = JSON.parse(line);

        if (data.type === 'start_session') {
          const sessionId = crypto.randomUUID();
          sessionToSocket.set(sessionId, socket);

          const worker = workers[nextWorkerIdx];
          sessionToWorker.set(sessionId, worker);
          nextWorkerIdx = (nextWorkerIdx + 1) % WORKER_COUNT;

          worker.postMessage({ sessionId, ...data });
        }
        else {
          const { sessionId } = data;
          const worker = sessionToWorker.get(sessionId);

          if (!worker) {
              socket.write(JSON.stringify({ error: 'Session not found' }) + '\n');
              continue;
          }

          worker.postMessage(data);
        }
      } catch (err) {
        socket.write(JSON.stringify({ error: 'Malformed payload' }) + '\n');
      }
    }
  });

  socket.on('close', () => {
    for (const [sessionId, s] of sessionToSocket.entries()) {
      if (s === socket) {
        sessionToSocket.delete(sessionId);
        sessionToWorker.delete(sessionId);
      }
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TCP IPC server listening on 127.0.0.1:${PORT}`);
});
