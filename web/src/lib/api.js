export class ApiError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
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
  if (!res.ok) throw new ApiError(res.status, data?.error || 'server_error')
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
}
