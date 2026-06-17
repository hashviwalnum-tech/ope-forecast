type Listener = () => void
const _listeners = new Set<Listener>()

export function subscribeOrderChange(fn: Listener): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

export function emitOrderChange(): void {
  _listeners.forEach(fn => fn())
}
