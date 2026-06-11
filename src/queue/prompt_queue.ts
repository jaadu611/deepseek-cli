export interface QueuedPrompt {
  id: string;
  text: string;
  timestamp: number;
}

export class PromptQueue {
  private queue: QueuedPrompt[] = [];
  private listeners: ((queue: QueuedPrompt[]) => void)[] = [];

  enqueue(text: string): string {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const prompt: QueuedPrompt = { id, text: text.trim(), timestamp: Date.now() };
    this.queue.push(prompt);
    this._notify();
    return id;
  }

  dequeue(): QueuedPrompt | undefined {
    const prompt = this.queue.shift();
    this._notify();
    return prompt;
  }

  peek(): QueuedPrompt | undefined {
    return this.queue[0];
  }

  remove(id: string): boolean {
    const idx = this.queue.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this._notify();
      return true;
    }
    return false;
  }

  clear(): void {
    this.queue = [];
    this._notify();
  }

  getAll(): QueuedPrompt[] {
    return [...this.queue];
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Subscribe to queue changes. Returns an unsubscribe function. */
  subscribe(listener: (queue: QueuedPrompt[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.getAll());
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private _notify(): void {
    const snapshot = this.getAll();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[PromptQueue] listener error:', err);
      }
    }
  }
}

export const globalPromptQueue = new PromptQueue();
