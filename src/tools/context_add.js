const { recordContext, getContextSummary } = require('../utils/context');

module.exports = {
  name: "context_add",
  description: "Manually add a file path or note to the context cache. Helps the agent remember relevant information across turns.",
  parameters: {
    type: "object",
    properties: {
      entry: { type: "string", description: "The file path or note to add to context." }
    },
    required: ["entry"]
  },
  async execute({ entry }) {
    try {
      if (!entry || typeof entry !== 'string' || entry.trim() === '') {
        return 'Error: Required parameter "entry" is missing or empty.';
      }
      recordContext(entry);
      const summary = getContextSummary();
      return `Context entry added: ${entry}\n${summary}`;
    } catch (err) {
      return `Error adding context: ${err.message}`;
    }
  }
};
