// Tiny typed event bus.
type Handler<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(k: K, fn: Handler<Events[K]>): () => void {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit<K extends keyof Events>(k: K, payload: Events[K]) {
    const s = this.map.get(k);
    if (s) for (const fn of [...s]) fn(payload);
  }
}
