const { parentPort } = require('worker_threads');
const { EnvWrapper } = require('../envs/singleEnv.js');

class GameInstance {
  constructor(sourcePath) {
    this.env = new EnvWrapper(sourcePath, false);
    this.stepSequence = [];
  }

  async start() {
    await this.env.start();
    await this.env.genericInit();
  }

  async getState() {
    const state = await this.env.getGameState()
    return {'current_state': state.grid_data.grid};
  }

  async getImage() {
    const state = await this.env.getStateImage();
    const idToHex = Object.fromEntries(Object.entries(this.env.globalPalette).map(([k, v]) => [v, k]))

    return {
      'id_to_hex': idToHex,
      'state': { 'image': state.image, 'rows': state.rows * 5, 'cols': state.cols * 5 }
    };
  }

  async step(action, logTransition=false) {
    const transition = await this.env.step(action, logTransition);
    return { transition }
  }

  async performStepSequence(stepSequence, logTransition = false) {
    if (stepSequence.length > 0) this.stepSequence = stepSequence;
    let transition;
    for (let i = 0; i < this.stepSequence.length; i++) {
      const action = stepSequence[i];
      transition = await this.env.step(action, logTransition);
    }
    return { transition }
  }

  async draw() {
    const { image, rows, cols } = await this.env.getStateImage();
    this.env.drawTerminalSprite(image, rows, cols);
  }

  async reset() {
    await this.env.reset();
  }

  close() {
    this.env.close();
  }
}

const workerSessions = new Map();

parentPort.on('message', async (message) => {
  if (message.type === 'start_session') {
    const game = new GameInstance('./sources/almost_akurra.ps');
    await game.start();

    workerSessions.set(message.sessionId, game);
    parentPort.postMessage({
      sessionId: message.sessionId,
      type: message.type
    });
  }
  else {
    const game = workerSessions.get(message.sessionId);

    if (!game) {
      parentPort.postMessage({
        sessionId: message.sessionId,
        type: message.type,
        error: 'Session not found'
      });
      return;
    }

    try {
      if (message.type === 'step') {
        const result = await game.step(message.action, message.log_transition);
        if (game.done) workerSessions.delete(message.sessionId);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result
        });
      } else if (message.type === 'perform_step_sequence') {
        const result = await game.performStepSequence(message.step_sequence, message.log_transition);
        if (game.done) workerSessions.delete(message.sessionId);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result
        });
      } else if (message.type === 'draw') {
        const result = await game.draw();
        if (game.done) workerSessions.delete(message.sessionId);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result
        });
      }
      else if (message.type === 'get_state') {
        const result = await game.getState();
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result,
        });
      }
      else if (message.type === 'get_image') {
        const result = await game.getImage();
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result,
        });
      }
      else if (message.type === 'reset') {
        await game.reset();
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type
        });
      }
      else if (message.type === 'close_session') {
        await game.close();
        workerSessions.delete(message.sessionId);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type
        });
      }
    } catch (err) {
      parentPort.postMessage({ sessionId: message.sessionId, error: err.message });
    }
  }
});
