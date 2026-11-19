// @ts-nocheck
const DeepSeekWebBrain = require("./deepseek-web");
const GLMWebBrain = require("./glm-web");

class BrainRegistry {
  constructor() {
    this.brains = new Map();
    this.activeBrainId = null;
    this.activeBrainInstance = null;
    this.subAgentBrainId = null;
    this.subAgentBrainInstance = null;

    // Register built-in brains
    this.register(DeepSeekWebBrain);
    this.register(GLMWebBrain);

    // Load saved brains from config
    try {
      const { loadConfig } = require("../../utils/config");
      const config = loadConfig();
      this.activeBrainId = config.default_brain || DeepSeekWebBrain.id;
      this.subAgentBrainId = config.default_sub_agent_brain || DeepSeekWebBrain.id;
    } catch (e) {
      this.activeBrainId = DeepSeekWebBrain.id;
      this.subAgentBrainId = DeepSeekWebBrain.id;
    }
  }

  register(BrainClass) {
    if (!BrainClass.id) {
      throw new Error("Cannot register brain without a static id");
    }
    this.brains.set(BrainClass.id, BrainClass);
  }

  getAvailableBrains() {
    return Array.from(this.brains.values()).map((B) => ({
      id: B.id,
      name: B.name,
    }));
  }

  setActiveBrain(id) {
    if (!this.brains.has(id)) {
      throw new Error(`Brain ${id} is not registered`);
    }
    if (this.activeBrainId !== id) {
      this.activeBrainId = id;
      this.activeBrainInstance = null; // Instantiated lazily
      
      try {
        const { loadConfig, saveConfig } = require("../../utils/config");
        const config = loadConfig();
        config.default_brain = id;
        saveConfig(config);
      } catch (e) {}
    }
  }

  getActiveBrain() {
    if (!this.activeBrainInstance && this.activeBrainId) {
      const BrainClass = this.brains.get(this.activeBrainId);
      this.activeBrainInstance = new BrainClass();
    }
    return this.activeBrainInstance;
  }

  setSubAgentBrain(id) {
    if (!this.brains.has(id)) {
      throw new Error(`Brain ${id} is not registered`);
    }
    if (this.subAgentBrainId !== id) {
      this.subAgentBrainId = id;
      this.subAgentBrainInstance = null; // Instantiated lazily
      
      try {
        const { loadConfig, saveConfig } = require("../../utils/config");
        const config = loadConfig();
        config.default_sub_agent_brain = id;
        saveConfig(config);
      } catch (e) {}
    }
  }

  getSubAgentBrain() {
    if (!this.subAgentBrainInstance && this.subAgentBrainId) {
      const BrainClass = this.brains.get(this.subAgentBrainId);
      this.subAgentBrainInstance = new BrainClass();
    }
    return this.subAgentBrainInstance;
  }
}

// Singleton registry instance
export = new BrainRegistry();
