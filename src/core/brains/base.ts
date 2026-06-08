// @ts-nocheck
class BaseBrain {
  /**
   * Unique identifier for this brain
   */
  static get id() {
    throw new Error("Brain must implement static id getter");
  }

  /**
   * Human-readable name of this brain
   */
  static get name() {
    throw new Error("Brain must implement static name getter");
  }

  /**
   * Initialize resources (e.g. browser launch, API key checks)
   */
  async init() {
    // optional hook
  }

  /**
   * Cleanup resources (e.g. close browser, flush logs)
   */
  async cleanup() {
    // optional hook
  }

  /**
   * Callback when a session is loaded
   * @param {object} session
   */
  async onSessionLoad(session) {
    // optional hook
  }

  /**
   * Callback to sync session metadata after a message/turn
   * @param {object} session
   * @param {string} prompt
   */
  async onSessionSync(session, prompt) {
    // optional hook
  }

  /**
   * Stream completion for a prompt
   * @param {string} prompt
   * @param {object} callbacks
   * @param {function} callbacks.onStartCalled - Invoked when streaming first starts
   * @param {function} callbacks.onProgress - Invoked with { thinking, text } when updates are received
   * @returns {Promise<{ thinkingText: string, responseText: string }>}
   */
  async getCompletionStream(prompt, { onStartCalled, onProgress }) {
    throw new Error("Brain must implement getCompletionStream");
  }
}

module.exports = BaseBrain;
