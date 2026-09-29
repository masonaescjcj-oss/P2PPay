// The demo server handles one request (or timer task) at a time, so a single "current store"
// is exact: nothing else runs while a transaction's callback is pending.
class AsyncLocalStorage {
  store = undefined
  getStore() {
    return this.store
  }
  run(store, fn, ...args) {
    const prev = this.store
    this.store = store
    let r
    try {
      r = fn(...args)
    } catch (err) {
      this.store = prev
      throw err
    }
    if (r && typeof r.then === 'function') {
      return r.finally(() => {
        this.store = prev
      })
    }
    this.store = prev
    return r
  }
}
module.exports = { AsyncLocalStorage }
