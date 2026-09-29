// Must be imported first: the server code expects Node's Buffer and process.
import { Buffer } from 'buffer'

globalThis.Buffer = Buffer
globalThis.process = globalThis.process || { env: {}, pid: 1, versions: {}, nextTick: (f, ...a) => queueMicrotask(() => f(...a)) }
globalThis.global = globalThis
// Node timers have .unref()/.ref(); browser timer ids are numbers. Make those calls no-ops here.
if (!Number.prototype.unref) {
  Object.defineProperty(Number.prototype, 'unref', { value() { return this }, configurable: true })
  Object.defineProperty(Number.prototype, 'ref', { value() { return this }, configurable: true })
}

// The npm buffer package predates 'base64url' (session tokens use it); add it.
const toStr = Buffer.prototype.toString
Buffer.prototype.toString = function (enc, ...rest) {
  if (enc === 'base64url') return toStr.call(this, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return toStr.call(this, enc, ...rest)
}
const from = Buffer.from
Buffer.from = function (value, enc, ...rest) {
  if (enc === 'base64url' && typeof value === 'string') return from.call(this, value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return from.call(this, value, enc, ...rest)
}
