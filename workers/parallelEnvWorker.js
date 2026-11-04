const { parentPort } = require('worker_threads');
const { ParallelEnvironment } = require('../envs/parallelEnv.js');

const GAME_TITLE = 'example_game';
// const GAME_TITLE = 'boston_tea_party';

function getTwoLetterCode(index) {
  const first = "abcdefghijklmnopqrstuvwxyz"[Math.floor(index / 26) % 26];
  const second = "abcdefghijklmnopqrstuvwxyz"[index % 26];
  return first + second;
}

class GameInstance {
  constructor(gameTitle, perfectMode) {
    this.env = new ParallelEnvironment(gameTitle, false, perfectMode, 'broken_game');
    // this.env = new ParallelEnvironment(gameTitle, false, perfectMode, 'empty_game');
    this.stepSequence = [];
  }

  async start() {
    await this.env.start();
    await this.env.genericInit();
  }

  async getState() {
    const state = await this.env.hypothesisEnv.getGameState()
    return {'current_state': state.grid_data.grid};
  }

  async getImage() {
    const obsState = await this.env.realEnv.getStateImage();
    const obsIdToHex = Object.fromEntries(Object.entries(this.env.realEnv.globalPalette).map(([k, v]) => [v, k]))

    const expState = await this.env.hypothesisEnv.getStateImage();
    const expIdToHex = Object.fromEntries(Object.entries(this.env.hypothesisEnv.globalPalette).map(([k, v]) => [v, k]))

    return {
      'observed': {
        'id_to_hex': obsIdToHex,
        'state': { 'image': obsState.image, 'rows': obsState.rows * 5, 'cols': obsState.cols * 5 }
      },
      'expected': {
        'id_to_hex': expIdToHex,
        'state': { 'image': expState.image, 'rows': expState.rows * 5, 'cols': expState.cols * 5 }
      }
    };
  }

  async step(action, logTransition=false) {
    const { observedTransition, expectedTransition } = await this.env.step(action, logTransition);
    return { observedTransition, expectedTransition }
  }

  buildDivergenceMatrix(state1, state2) {
    const divergenceDefinitions = {};
    const codeMap = {};
    let codeIndex = 0;

    const maxRows = Math.max(state1.length, state2.length);
    const maxCols = Math.max(state1[0].length, state2[0].length);

    const divergenceMatrix = [];

    for (let r = 0; r < maxRows; r++) {
      const divergenceRow = [];
      for (let c = 0; c < maxCols; c++) {
        const expected_chunk = this.env.hypothesisEnv.getColoredSprite((r < state1.length && c < state1[0].length) ? state1[r][c] : null);
        const observed_chunk = this.env.realEnv.getColoredSprite((r < state2.length && c < state2[0].length) ? state2[r][c] : null);

        const isIdentical = JSON.stringify(expected_chunk) === JSON.stringify(observed_chunk);
        const divergenceLabel = isIdentical ? 'NO_CHANGE' : (JSON.stringify(expected_chunk) + '_vs_' + JSON.stringify(observed_chunk));

        if (!codeMap[divergenceLabel]) {
          if (isIdentical) {
            codeMap[divergenceLabel] = '.';
          } else {
            const shortCode = getTwoLetterCode(codeIndex);
            codeMap[divergenceLabel] = shortCode;
            divergenceDefinitions[shortCode] = { expected_chunk, observed_chunk };
            codeIndex++;
          }
        }

        divergenceRow.push(codeMap[divergenceLabel]);
      }
      divergenceMatrix.push(divergenceRow);
    }

    return { divergenceMatrix, divergenceDefinitions };
  }

  async evaluateDivergence(stepSequence = []) {
    if (stepSequence.length > 0) this.stepSequence = stepSequence;
    const stepsTaken = [];
    for (let i = 0; i < this.stepSequence.length; i++) {
      const action = this.stepSequence[i];
      const { observedTransition, expectedTransition } = await this.env.step(action, true);

      if (i === 0 && JSON.stringify(observedTransition.state_before_action.image) !== JSON.stringify(expectedTransition.state_before_action.image)) {
        const { divergenceMatrix, divergenceDefinitions } = this.buildDivergenceMatrix(expectedTransition.state_before_action.abstract, observedTransition.state_before_action.abstract);
        return {
          'type_of_divergence': 'first_state',
          'transition_info': {
            'divergence_definitions': divergenceDefinitions,
            'divergence_matrix': divergenceMatrix,
          },
        }
      }

      const match = JSON.stringify(observedTransition.state_after_action.image) === JSON.stringify(expectedTransition.state_after_action.image);

      if (!match) {
        return {
          'type_of_divergence': 'mid_sequence',
          'transition_info': {
            'last_common_state': expectedTransition.state_before_action.abstract,
            'action': action,
            'expected_delta': expectedTransition.delta,
            'observed_delta': observedTransition.delta,
            'steps_before_divergence': stepsTaken,
          },
        }
      }
      stepsTaken.push(action);
    }

    return {
      'type_of_divergence': null,
      'transition_info': {
        'steps_taken_so_far': stepsTaken,
      }
    };
  }

  async getHypothesis() {
    const currentHypothesis = await this.env.hypothesisEnv.getSource();
    return {"current_hypothesis": currentHypothesis}
  }

  async updateHypothesis(hypothesis) {
    await this.env.hypothesisEnv.updateSource(hypothesis);
    await this.reset();
  }

  async updateAndValidate(hypothesis, stepSequence) {
    await this.updateHypothesis(hypothesis);
    return await this.evaluateDivergence(stepSequence);
  }

  async updateAssets(assetSource) {
    await this.env.assetValidationEnv.updateSource(assetSource);
  }

  async evaluateAbstractTransition(startImage, startAbstract, endImage, endAbstract) {
    const reconstructedStartImage = await this.env.assetValidationEnv.gridToImage(startAbstract);
    const reconstructedEndImage = await this.env.assetValidationEnv.gridToImage(endAbstract);

    const startStatesMatch = JSON.stringify(reconstructedStartImage) === JSON.stringify(startImage);
    const endStatesMatch = JSON.stringify(reconstructedEndImage) === JSON.stringify(endImage);
    return {
      'start_states_match': startStatesMatch,
      'end_states_match': endStatesMatch,
    };
  }

  async draw() {
    const { image, rows, cols } = await this.env.realEnv.getStateImage();
    this.env.realEnv.drawTerminalSprite(image, rows, cols);
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
    const game = new GameInstance(GAME_TITLE, message.perfect_mode);
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
      else if (message.type === 'evaluate_divergence') {
        const result = await game.evaluateDivergence(message.step_sequence);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result
        });
      }
      else if (message.type === 'get_hypothesis') {
        const result = await game.getHypothesis();
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result,
        });
      }
      else if (message.type === 'update_and_validate') {
        const result = await game.updateAndValidate(message.hypothesis, message.step_sequence);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result,
        });
      }
      else if (message.type === 'update_assets') {
        const result = await game.updateAssets(message.asset_source);
        parentPort.postMessage({
          sessionId: message.sessionId,
          type: message.type,
          ...result,
        });
      }
      else if (message.type === 'evaluate_abstract_transition') {
        const result = await game.evaluateAbstractTransition(message.state_before_action.image, message.state_before_action.abstract, message.state_after_action.image, message.state_after_action.abstract);
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
