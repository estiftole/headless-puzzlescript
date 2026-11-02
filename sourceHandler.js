const fs = require('fs');

function getSource(sourcePath) {
    return fs.readFileSync(sourcePath, 'utf-8');
}

function getMetadata(code) {
    const meta = {
        title: "PuzzleScript Game",
        safe_title: "",
        bgcolor: "black",
        fgcolor: "lightblue"
    };

    const lines = code.split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || line.startsWith('(')) {
            continue;
        }
        if (line.toUpperCase() === 'OBJECTS') {
            break;
        }

        const titleMatch = line.match(/^title\s+(.+)$/i);
        if (titleMatch) {
            meta.title = titleMatch[1].trim();
            meta.safe_title = meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        }

        const bgMatch = line.match(/^(?:background_color|bg_color)\s+(.+)$/i);
        if (bgMatch) {
            meta.bgcolor = bgMatch[1].trim();
        }

        const fgMatch = line.match(/^(?:text_color|fg_color)\s+(.+)$/i);
        if (fgMatch) {
            meta.fgcolor = fgMatch[1].trim();
        }
    }

    return meta;
}

function saveSource(gameScript, outputDir, saveLatest = true) {
    fs.writeFileSync(outputDir, gameScript, 'utf-8');

    if (saveLatest) {
        fs.writeFileSync("sources/latest_game.ps", gameScript, 'utf-8');
    }

    console.log(`Saved game to '${outputDir}'`);
}

function splitRulesLevels(gameScript) {
    const [rules, levels] = gameScript.split("=======\nLEVELS\n=======");
    return [rules, levels];
}


module.exports = { getSource, getMetadata, saveSource, splitRulesLevels };
