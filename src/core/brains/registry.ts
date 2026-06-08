// @ts-nocheck
const DeepSeekWebBrain = require("./deepseek-web");

class BrainRegistry {
  constructor() {
    this.brains = new Map();
    this.activeBrainId = null;
    this.activeBrainInstance = null;

    // Register built-in brains
    this.register(DeepSeekWebBrain);

    // Default to deepseek-web
    this.setActiveBrain(DeepSeekWebBrain.id);
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
    }
  }

  getActiveBrain() {
    if (!this.activeBrainInstance && this.activeBrainId) {
      const BrainClass = this.brains.get(this.activeBrainId);
      this.activeBrainInstance = new BrainClass();
    }
    return this.activeBrainInstance;
  }
}

// Singleton registry instance
module.exports = new BrainRegistry();
