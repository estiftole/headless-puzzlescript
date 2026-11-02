const fs = require('fs').promises;
const path = require('path');

async function getSource(sourcePath) {
    try {
        const sourceCode = await fs.readFile(path.resolve(sourcePath), 'utf-8');
        return sourceCode;
    } catch (error) {
        console.error("Error reading file:", error);
        throw error;
    }
}

function saveSource(source, output_dir) {
  fs.writeFileSync(path.resolve(output_dir), source);
  console.log(`Saved game to '${output_dir}'`)
}

module.exports = { getSource, saveSource };
