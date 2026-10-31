/** A line of items taken in the order they were added, each add and take in constant time. */
export class Fifo<Item> {
  #items: Item[] = [];
  #head = 0;

  get length(): number {
    return this.#items.length - this.#head;
  }

  /** Adds an item at the tail. */
  push(item: Item): void {
    this.#items.push(item);
  }

  /** Adds an item at the head, so it is taken next. */
  unshift(item: Item): void {
    if (this.#head > 0) {
      this.#head -= 1;
      this.#items[this.#head] = item;
      return;
    }
    this.#items.unshift(item);
  }

  /** Takes the item at the head, or `undefined` when none is lined up. */
  shift(): Item | undefined {
    if (this.length === 0) {
      return undefined;
    }
    const item = this.#items[this.#head];
    this.#head += 1;
    if (this.#head * 2 >= this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return item;
  }
}
