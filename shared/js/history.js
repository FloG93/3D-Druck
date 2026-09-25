// Undo/redo stack of document snapshots (JSON strings).

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  reset(snapshot) {
    this.stack = [snapshot];
    this.index = 0;
  }

  push(snapshot) {
    if (snapshot === this.stack[this.index]) return false;
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  /** Replaces the current step (a follow-up change that belongs to it). */
  replace(snapshot) {
    if (this.index < 0) this.reset(snapshot);
    else this.stack[this.index] = snapshot;
  }

  undo() {
    return this.index > 0 ? this.stack[--this.index] : null;
  }

  redo() {
    return this.index < this.stack.length - 1 ? this.stack[++this.index] : null;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }
}
