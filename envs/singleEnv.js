const { getSource, saveSource } = require('../utils/sourceUtils.js');
const { iframeInstance } = require('../utils/htmlHandler.js');
const { JSDOM } = require('jsdom');

const KEYMAP  = {
  "Left": 37,
  "Up": 38,
  "Right": 39,
  "Down": 40,
  "X": 88,
  "Z": 90,
  "Restart": 82,
  "Escape": 27
}

const SCRIPTS = {
  "PREGAME_SCRIPT": `
    muted = 1;
    showContinueOptionOnTitleScreen = function () {};
    window.compilerErrorLogs = [];
    function getGrid() {
      return {
        width: level.width,
        height: level.height,
        grid: transpose(visibleGrid)
      };
    };

    function getStateObjects() {
      const legend = {};
      if (typeof state !== 'undefined' && state.objects) {
        const entries = state.objects instanceof Map ? state.objects.entries() : Object.entries(state.objects);
        for (const [name, data] of entries) {
          if (typeof data === 'object' && data !== null) {
            legend[name] = {
              colors: data.colors || [],
              spritematrix: data.spritematrix || data.dat || []
            };
          }
        }
      }
      return legend;
    };

    async function waitForReady () {
      while (typeof againing !== 'undefined' && againing) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };

    function skipWin () {
      if (winning) {
        winning;
        nextLevel();
      }
    };

    async function stepKey (code) {
      const mockEvent = {
        keyCode: code,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {}
      };

      checkKey(mockEvent, true);
    }

  `,
  "RECOMPILE_SCRIPT": String.raw`
    const originalConsolePrint = consolePrint;
    const LOG_PATTERN = /(?:jumpToLine\((\d+)\)[\s\S]*?)?<span class="(?:warningText|errorText)">(.*?)<\/span>/;
    consolePrint = function(linenumber, inspect_ID) {
      if (inspect_ID) {
        const match = LOG_PATTERN.exec(linenumber);
        if (match) {
          window.compilerErrorLogs.push({
            lineNumber: match[1] ? Number(match[1]) : null,
            message: match[2],
            warning: linenumber.includes("warning"),
          });
        }
      }
    };
    compile(["restart"], sourceCode);
    consolePrint = originalConsolePrint;
  `,
  "GET_STATE_SCRIPT": `
  (async () => {
    await waitForReady();
    return {
      grid_data: getGrid(),
      state_objects: getStateObjects()
    };
  })();
  `,
  "DISABLE_RENDER_SCRIPT": ``
}

class EnvWrapper {
  constructor(sourcePath, notify = true, iframeId = 'gameFrame', masterDom = null) {
    if (masterDom === null) {
      this.masterDom = new JSDOM(`<!DOCTYPE html><html><body><iframe id="gameFrame"></iframe></body></html>`, {
        runScripts: "dangerously",
        resources: "usable",
        pretendToBeVisual: false,
        url: "file://" + __dirname + "/host.html"
      });
    } else {
      this.masterDom = masterDom;
    }
    this.iframeId = iframeId;
    this.sourcePath = sourcePath;
    this.source = "";
    this.legend = undefined;
    this.spriteCache = {};
    this.rawSpriteCache = {};
    this.globalPalette = {};
    this.idToHex = {};
    this.notify = notify;
    if (this.notify) {
      console.log("Created template environment.");
    }
  }

  async start() {
    this.window = iframeInstance(this.masterDom, `./html/template.html`, this.iframeId);
    this.preGameSetup();
    await this.hotswapGame(this.sourcePath, undefined);
    if (this.notify) {
      console.log("Started game environment.");
    }
  }

  async genericInit() {
    await this.skipMessages();
    await this.updateLegend();
  }

  async updateLegend() {
    const state = await this.getGameState()
    const stateObjects = state.state_objects

    const globalPalette = {};
    const idToHex = {};
    let nextColorId = 1;

    for (const data of Object.values(stateObjects)) {
      for (const color of data.colors || []) {
        if (!globalPalette.hasOwnProperty(color) && color.toLowerCase() !== "transparent") {
          globalPalette[color] = nextColorId;
          idToHex[nextColorId] = color;
          nextColorId++;
        }
      }
    }

    globalPalette["transparent"] = -1;
    this.legend = { ...stateObjects };
    this.globalPalette = globalPalette;
    this.idToHex = idToHex;
  }

  async setEngineSeed(seed) {
    await this.eval(`
      (() => {{
        const OriginalRNG = window.RNG;

        window.RNG = function(seed) {{
          const deterministicSeed = "${seed}";
          return new OriginalRNG(deterministicSeed);
        }};

        if (OriginalRNG && OriginalRNG.prototype) {{
          window.RNG.prototype = OriginalRNG.prototype;
        }}
      }})();
    `);
  }

  async preGameSetup(seed = 1337) {
    await this.setEngineSeed(seed);
    await this.eval(SCRIPTS["PREGAME_SCRIPT"]);
  }

  async getScreenMessage() {
    return await this.eval(`
      (() => {
        return titleImage;
      })();
    `);
  }

  async getGameState() {
    return await this.eval(SCRIPTS["GET_STATE_SCRIPT"]);
  }

  getStackedSpritematrix(cellObjects) {
    const stack = Array.from({ length: 5 }, () => new Int32Array(5));
    for (const objName of cellObjects) {
      const objInfo = this.legend[objName];
      if (!objInfo) continue;

      const localMatrix = objInfo.spritematrix || [];
      const colors = objInfo.colors || [];

      if (localMatrix.length === 0 || colors.length === 0) continue;

      const localToGlobal = colors.map(c => this.globalPalette[c] ?? -1);

      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const localVal = localMatrix[r]?.[c];
          if (localVal !== undefined && localVal >= 0) {
            const globalVal = localToGlobal[localVal] ?? -1;
            if (globalVal >= 0) {
              stack[r][c] = globalVal;
            }
          }
        }
      }

    }
    return stack;
  }

  getSprite(cellObjects) {
    if (cellObjects === null) {
      return 'empty';
    }
    const cacheKey = cellObjects.join(",");
    if (!this.spriteCache[cacheKey]) {
      this.spriteCache[cacheKey] = this.getStackedSpritematrix(cellObjects);
    }
    return this.spriteCache[cacheKey];
  }

  getColoredSprite(cellObjects) {
    if (cellObjects === null) {
      return 'empty';
    }
    const cacheKey = cellObjects.join(",");
    if (!this.rawSpriteCache[cacheKey]) {
      const stack = this.getStackedSpritematrix(cellObjects);

      this.rawSpriteCache[cacheKey] = Array.from({ length: stack.length }, () =>
        Object.seal(new Array(stack[0].length).fill(0))
      );

      for (let r = 0; r < stack.length; r++) {
        for (let c = 0; c < stack[0].length; c++) {
          this.rawSpriteCache[cacheKey][r][c] = this.idToHex[stack[r][c]];
        }
      }
    }
    return this.rawSpriteCache[cacheKey];
  }

  getDelta(state_before_action, state_after_action, currentLocation = []) {
    let differences = [];
    const maxLength = Math.max(state_before_action.length, state_after_action.length);

    for (let i = 0; i < maxLength; i++) {
      const location = [...currentLocation, i];
      const val1 = state_before_action[i];
      const val2 = state_after_action[i];

      const isArray1 = Array.isArray(val1);
      const isArray2 = Array.isArray(val2);

      if (isArray1 && isArray2) {
        differences.push(...this.getDelta(val1, val2, location));
      } else if (isArray1 !== isArray2 || val1 !== val2) {
        differences.push({
          'location': [...currentLocation],
          state_before_action,
          state_after_action
        });
      }
    }

    return differences;
  };

  getDeltaSprite(state_before_action, state_after_action, currentLocation = [], differences = {}) {
    const maxLength = Math.max(state_before_action.length, state_after_action.length);

    for (let i = 0; i < maxLength; i++) {
      const val1 = state_before_action[i];
      const val2 = state_after_action[i];

      const isArray1 = Array.isArray(val1);
      const isArray2 = Array.isArray(val2);

      if (isArray1 && isArray2) {
        this.getDeltaSprite(val1, val2, [...currentLocation, i], differences);
      } else if (isArray1 !== isArray2 || val1 !== val2) {
        differences[`sprite_at_${currentLocation}`] = {
          'sprite_before_action': this.getColoredSprite(state_before_action),
          'sprite_after_action': this.getColoredSprite(state_after_action)
        };
      }
    }

    return differences;
  };

  async gridToImage(grid) {
    if (Array.isArray(grid) !== true) { return []; }
    if (grid.length === 0) { return []; }
    if (Array.isArray(grid[0]) !== true) { return []; }

    const rows = grid.length;
    const cols = grid[0].length;
    const width = 5;

    const fullImage = new Array(rows * cols * width ** 2);
    const shift = cols * width;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellObjects = grid[r][c];


        const sprite = this.getSprite(cellObjects);
        const spriteR = r * cols * width ** 2;
        const spriteC = c * width;
        const startI = spriteR + spriteC;

        for (let pr = 0; pr < 5; pr++) {
          for (let pc = 0; pc < 5; pc++) {
            fullImage[startI + shift * pr + pc] = sprite[pr][pc];
          }
        }
      }
    }
    return fullImage;
  }

  async getStateImage() {
    const state = await this.getGameState();
    const grid = state.grid_data.grid;
    return {"image": await this.gridToImage(grid), "rows": state.grid_data.grid.length, "cols": state.grid_data.grid[0].length};
  }

  drawTerminalSprite(image, rows, cols) {
    const width = 5;

    const namedColors = {
      'black': '#000000', 'white': '#ffffff', 'red': '#ff0000',
      'blue': '#0000ff', 'green': '#00ff00', 'yellow': '#ffff00',
      'orange': '#ffa500', 'purple': '#800080', 'transparent': null
    };

    function getRgb(colorStr) {
      if (!colorStr) return null;
      let str = colorStr.toLowerCase();
      if (namedColors[str]) str = namedColors[str];

      if (!str || str === 'transparent') return null;

      str = str.replace('#', '');
      if (str.length === 3) str = str.split('').map(c => c + c).join('');

      const val = parseInt(str, 16);
      if (isNaN(val)) return [0, 0, 0];
      return [(val >> 16) & 255, (val >> 8) & 255, val & 255];
    }

    let buffer = "";
    for (let r = 0; r < rows*width; r++) {
      for (let c = 0; c < cols*width; c++) {
        const pixelId = image[r*cols*width+c];
        const hexColor = this.idToHex[pixelId];

        if (pixelId === 0 || pixelId === -1 || !hexColor) {
          buffer += "\x1b[0m  ";
        } else {
          const rgb = getRgb(hexColor);
          if (rgb) {
            buffer += `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m  \x1b[0m`;
          } else {
            buffer += "\x1b[0m  ";
          }
        }
      }
      buffer += "\n";
    }
    process.stdout.write(buffer);
  }

  async step(action, logTransition=false) {
    let transition = {"action": action};

    if (logTransition) {
      transition.state_before_action = {};
      transition.state_before_action.abstract = (await this.getGameState()).grid_data.grid;
      transition.state_before_action.image = await this.gridToImage(transition.state_before_action.abstract);
    };

    await this.eval(`
      (async () => { await waitForReady(); await stepKey(${KEYMAP[action]}); skipWin(); })();
    `);

    if (logTransition) {
      transition.state_after_action = {};
      transition.state_after_action.abstract = (await this.getGameState()).grid_data.grid;
      transition.state_after_action.image = await this.gridToImage(transition.state_after_action.abstract);

      transition.delta = this.getDeltaSprite(transition.state_before_action.abstract, transition.state_after_action.abstract);
    };


    return transition;
  }

  async skipMessages() {
    let lastSkippedMsg = "";
    let gridIsVisible;
    while (true) {
      gridIsVisible = await this.eval(`
        (() => {
          return (state.levels[curlevel].message === undefined) && !JSON.stringify(titleImage).includes("# start game #") && !quittingTitleScreen && !titleScreen;
        })();
      `);

      if (gridIsVisible) {
        break;
      }

      const message = JSON.stringify(await this.getScreenMessage());
      const isActionPrompt = message.includes("R to restart") || message.includes("X to continue") || message.includes("X to action");
      const isClosing = message.includes("#-");

      if (isActionPrompt && !isClosing && lastSkippedMsg !== message) {
        lastSkippedMsg = message;
        await this.step('X');
      }
      await this.proceed();
      await new Promise(setImmediate);
    }
  }

  async proceed() {
    const canProceed = await this.eval(`(async () => {{
        await waitForReady();
        return proceed
    }})();`)
    if (canProceed) {
      await this.eval('proceedToLevel();')
    }
  }

  async reset(factory = false) {
    if (factory) {
      this.legend = undefined;
      this.spriteCache = {};
      this.rawSpriteCache = {};
      this.globalPalette = {};
      this.idToHex = {};
    }
    await this.eval('(async () => {await compile(["restart"], sourceCode); curlevel = 0;})();');
  }

  async recompile() {
    await this.eval(SCRIPTS["RECOMPILE_SCRIPT"])
  }

  async hotswapFromSource(source) {
    this.source = source;
    await this.eval(`
      sourceCode = \`${this.source.replaceAll('`', '\\`')}\`;
    `);
    await this.recompile();
    await this.reset(true);

    if (this.notify) {
      console.log(`Loaded game from '${this.sourcePath}'.`);
    }
  }

  async hotswapGame(sourcePath = null, source = undefined) {
    if (source === undefined) {
      source = await getSource(sourcePath);
    }
    await this.hotswapFromSource(source);
  }

  async getSource() {
    return await this.eval('sourceCode;');
  }

  async updateSource(source, save = false) {
    if (save) {
      saveSource(source, this.sourcePath);
    }
    await this.hotswapGame(null, source);
    await this.genericInit();
  }

  async evalDivergence(transitions) {
    const actionsTaken = [];
    for (let i = 0; i < transitions.length; i++) {
      const obsTransition = transitions[i];
      const action = obsTransition.action;
      const expTransition = await this.step(action, true);

      if (i === 0 && JSON.stringify(obsTransition.start_image) !== JSON.stringify(expTransition.start_image)) {
        return {
          "log": {
          "diverged": true,
          "image": "",
          "abstract": "",
          "action": "",
          "exp_state": {
            "image": expTransition.start_image,
            "abstract": expTransition.start_abstract,
          },
          "obs_state": {
            "image": obsTransition.start_image,
            "abstract": ""
          },
          "note": "Diverged on first state before_action any actions."
        },
        "actionsTaken": actionsTaken
        }
      }

      const match = JSON.stringify(obsTransition.end_image) === JSON.stringify(expTransition.end_image);

      if (!match) {
        return {
          "log": {
          "diverged": true,
          "image": expTransition.start_image,
          "abstract": expTransition.start_abstract,
          "action": action,
          "exp_state": {
            "image": expTransition.end_image,
            "abstract": expTransition.end_abstract,
          },
          "obs_state": {
            "image": obsTransition.end_image,
            "abstract": ""
          },
          "note": `Diverged on ${i}th transition.`
          },
          "actionsTaken": actionsTaken
        }
      }

      actionsTaken.push(action);
    }

    return {
      "log":
        { "diverged": false, "note": "No divergences. It's a perfect match." },
      "actionsTaken": actionsTaken
    };
  }


  async eval(script) {
    return await this.window.eval(script);
  }

  close(closeProcess = false) {
    this.window.window.close();
    if (closeProcess) {
      process.exit(0);
    }
  }
}

module.exports = { EnvWrapper };
