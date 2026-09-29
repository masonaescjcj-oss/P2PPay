export class ApiError extends Error {
  // data: the full error body, e.g. { error: 'beta_trade_limit', max: '100' } — used to fill the message.
  constructor(status, code, data = null) {
    super(code)
    this.status = status
    this.code = code
    this.data = data
  }
}

async function request(method, path, body) {
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network_error')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    // non-JSON response
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'server_error', data)
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  // Raw image upload; the custom header is what the server's CSRF guard expects for uploads.
  async upload(path, blob) {
    let res
    try {
      res = await fetch(`/api${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': blob.type || 'image/jpeg', 'x-ariapay-upload': '1' },
        body: blob,
      })
    } catch {
      throw new ApiError(0, 'network_error')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(res.status, data?.error || 'server_error', data)
    return data
  },
}
