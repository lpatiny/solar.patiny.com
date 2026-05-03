import type {
  SQLInputValue,
  StatementResultingChanges,
  StatementSync,
} from 'node:sqlite';

export class TypedStatementSync<T> {
  readonly #stmt: StatementSync;
  readonly #onSlow: ((ms: number) => void) | undefined;

  public constructor(stmt: StatementSync, onSlow?: (ms: number) => void) {
    this.#stmt = stmt;
    this.#onSlow = onSlow;
  }

  #timed<R>(fn: () => R): R {
    const start = performance.now();
    const result = fn();
    const ms = performance.now() - start;
    if (ms > 100) this.#onSlow?.(ms);
    return result;
  }

  public get(...params: SQLInputValue[]): T | undefined {
    return this.#timed(() => this.#stmt.get(...params) as T | undefined);
  }

  public getRequired(...params: SQLInputValue[]): T {
    return this.#timed(() => {
      const row = this.#stmt.get(...params);
      if (row === undefined) throw new Error('Expected a row but got none');
      return row as T;
    });
  }

  public all(...params: SQLInputValue[]): T[] {
    return this.#timed(() => this.#stmt.all(...params) as T[]);
  }

  public run(...params: SQLInputValue[]): StatementResultingChanges {
    return this.#timed(() => this.#stmt.run(...params));
  }
}
