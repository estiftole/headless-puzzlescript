const { EnvWrapper } = require('./env.js');
const { JSDOM } = require('jsdom');

class ParallelEnvironment {
  constructor(gameTitle = '', notify = true, perfectMode=false, hypothesisTitle = 'workspace/hypothesis', assetValidationTitle = 'assets') {
    this.masterDom = new JSDOM(`<!DOCTYPE html><html><body><iframe id='gameFrame'></iframe></body></html>`, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: false,
      url: 'file://' + __dirname + '/host.html'
    });

    this.notify = notify;
    if (this.notify) {
      console.log('Creating prog-synth environment...');
    };

    this.gamePath = `./sources/${gameTitle}.ps`;
    this.hypothesisPath = `./sources/${hypothesisTitle}.ps`
    // this.assetValidationPath = `./sources/workspace/${assetValidationTitle}.ps`
    if (perfectMode) this.hypothesisPath = this.gamePath;

    this.realEnv = new EnvWrapper(this.gamePath, this.notify, 'real', this.masterDom);
    this.hypothesisEnv = new EnvWrapper(this.hypothesisPath, this.notify, 'hypothesis', this.masterDom);
    // this.assetValidationEnv = new EnvWrapper(this.assetValidationPath, this.notify, 'assets', this.masterDom);

    if (this.notify) {
      console.log('Finished creating prog-synth environment.\n');
    };
  }

  async start() {
    if (this.notify) {
      console.log('Starting prog-synth environment...');
    };

    await this.realEnv.start();
    await this.hypothesisEnv.start();
    // await this.assetValidationEnv.start();

    if (this.notify) {
      console.log('Finished starting prog-synth environment.\n');
    };
  }

  async genericInit() {
    await this.realEnv.genericInit();
    await this.hypothesisEnv.genericInit();
    // await this.assetValidationEnv.genericInit();
  }

  async step(action, logTransition) {
    const observedTransition = await this.realEnv.step(action, logTransition);
    const expectedTransition = await this.hypothesisEnv.step(action, logTransition);
    return { observedTransition, expectedTransition };
  }

  async reset() {
    this.realEnv.reset();
    this.hypothesisEnv.reset();
    await this.genericInit();
  }

  close() {
    this.realEnv.close();
    this.hypothesisEnv.close();
  }

}

module.exports = { ParallelEnvironment };
