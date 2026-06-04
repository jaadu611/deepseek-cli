const fs = require('fs');
const path = require('path');

module.exports = {
  name: "write_file",
  description: "Writes complete content to a file. USE THIS INSTEAD OF patch_file WHEN: creating new files, rewriting entire files, or making changes larger than 15 lines. Automatically creates parent directories. Creates .bak backup if file exists.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write to." },
      content: { type: "string", description: "The complete file content to write." }
    },
    required: ["path", "content"]
  },
  async execute({ path: filePath, content }) {
    try {
      const resolved = path.resolve(filePath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      
      if (fs.existsSync(resolved)) {
        fs.writeFileSync(resolved + '.bak', fs.readFileSync(resolved, 'utf8'), 'utf8');
      }
      
      fs.writeFileSync(resolved, content, 'utf8');
      const action = fs.existsSync(resolved + '.bak') ? 'Overwritten' : 'Created';
      return `✅ ${action} ${resolved} (${content.split('\n').length} lines).`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  }
};
