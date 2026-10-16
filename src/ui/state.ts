import type { Difficulty } from '../data/types';

export type Selection =
  | { kind: 'none' }
  | { kind: 'generator'; index: number }
  | { kind: 'group'; row: number }
  | { kind: 'item'; key: string }
  | { kind: 'species'; name: string };

export interface State {
  stageId: string | null;
  difficulty: Difficulty;
  selection: Selection;
  query: string;
}

type Listener = (s: State, prev: State) => void;

export class Store {
  private listeners: Listener[] = [];
  constructor(public state: State) {}
  set(patch: Partial<State>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }
  subscribe(l: Listener): void {
    this.listeners.push(l);
  }
}
