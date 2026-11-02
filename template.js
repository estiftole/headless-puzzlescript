const { EnvWrapper } = require('./env.js');

async function main() {
  const gameTitle = 'example_game';
  console.log(`Playing ${gameTitle}`);

  const env = new EnvWrapper(`./sources/${gameTitle}.ps`);
  await env.start();
  await env.genericInit();

  actions = ["Right", "Right", "Up", "Up", "Up", "Up", "Left"];
  for (let i = 0; i < actions.length; i++) {
    action = actions[i];
    await env.step(action);
  }

  const { image, rows, cols } = await env.getStateImage();
  env.drawTerminalSprite(image, rows, cols);
  env.close();
}

main();
