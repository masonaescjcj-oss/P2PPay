// A small Express-compatible router, enough for the AriaPay server to run unchanged in the browser:
// app/router .use/.get/.post, :params, mounted routers, async handlers, error middleware.
function compile(path) {
  if (path instanceof RegExp) return { re: path, keys: [] }
  const keys = []
  const src = path.replace(/\/:([A-Za-z_]+)/g, (_, k) => {
    keys.push(k)
    return '/([^/]+)'
  })
  return { re: new RegExp(`^${src}/?$`), keys }
}

function createRouter() {
  const layers = []
  const add = (method, path, fns) => {
    for (const fn of fns.flat()) layers.push({ method, route: path, ...compile(path), fn })
  }
  function router(req, res, done) {
    return router.handle(req, res, done)
  }
  router.use = (...args) => {
    const prefix = typeof args[0] === 'string' ? args.shift() : null
    for (const fn of args.flat()) layers.push({ method: null, prefix, fn })
    return router
  }
  router.get = (path, ...fns) => (add('GET', path, fns), router)
  router.post = (path, ...fns) => (add('POST', path, fns), router)
  router.handle = (req, res, done) => {
    let i = 0
    const next = (err) => {
      if (res.finished) return
      const layer = layers[i++]
      if (!layer) return done(err)
      const isErrorMw = layer.fn.length === 4
      if (err ? !isErrorMw : isErrorMw) return next(err)
      let call
      if (layer.method === null) {
        // middleware, possibly mounted at a prefix
        if (layer.prefix && !(req.path === layer.prefix || req.path.startsWith(layer.prefix + '/'))) return next(err)
        if (layer.prefix) {
          const saved = { path: req.path, baseUrl: req.baseUrl }
          req.baseUrl = (req.baseUrl || '') + layer.prefix
          req.path = req.path.slice(layer.prefix.length) || '/'
          call = () =>
            layer.fn(req, res, (e) => {
              req.path = saved.path
              req.baseUrl = saved.baseUrl
              next(e)
            })
        } else {
          call = () => (isErrorMw ? layer.fn(err, req, res, next) : layer.fn(req, res, next))
        }
      } else {
        if (layer.method !== req.method) return next(err)
        const m = req.path.match(layer.re)
        if (!m) return next(err)
        req.params = Object.fromEntries(layer.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]))
        req.route = { path: layer.route }
        call = () => (isErrorMw ? layer.fn(err, req, res, next) : layer.fn(req, res, next))
      }
      try {
        const r = call()
        if (r && typeof r.then === 'function') r.catch(next) // Express 5: rejected promises go to next(err)
      } catch (e) {
        next(e)
      }
    }
    next()
  }
  return router
}

function express() {
  const app = createRouter()
  app.locals = {}
  app.set = () => app
  app.disable = () => app
  app.listen = () => ({ close: (cb) => cb?.(), address: () => ({ port: 0 }) })
  // Runs one request through the app; resolves with { status, headers, body }.
  app.dispatch = (input) =>
    new Promise((resolve) => {
      const url = new URL(input.url, 'http://demo.local')
      const headers = Object.fromEntries(Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
      const req = {
        method: input.method,
        url: url.pathname + url.search,
        originalUrl: url.pathname + url.search,
        path: url.pathname,
        baseUrl: '',
        query: Object.fromEntries(url.searchParams),
        params: {},
        headers,
        body: input.body,
        ip: '127.0.0.1',
        get: (name) => headers[name.toLowerCase()],
        is(type) {
          const ct = (headers['content-type'] || '').split(';')[0].trim()
          if (!ct) return false
          if (type.endsWith('/*')) return ct.startsWith(type.slice(0, -1))
          return ct === type
        },
      }
      const out = { status: 200, headers: {}, body: null }
      const res = {
        finished: false,
        statusCode: 200,
        status(n) {
          out.status = n
          this.statusCode = n
          return this
        },
        setHeader(k, v) {
          out.headers[k.toLowerCase()] = v
        },
        getHeader: (k) => out.headers[k.toLowerCase()],
        json(obj) {
          out.headers['content-type'] = 'application/json'
          this.end(JSON.stringify(obj))
        },
        end(data) {
          if (this.finished) return
          this.finished = true
          out.body = data ?? null
          resolve(out)
        },
        sendFile() {
          this.status(404).end()
        },
      }
      app.handle(req, res, (err) => {
        if (!res.finished) res.status(err ? 500 : 404).json({ error: err ? 'server_error' : 'not_found' })
      })
    })
  return app
}

express.Router = createRouter
express.json = () => (_req, _res, next) => next() // bodies arrive already parsed
express.raw = () => (_req, _res, next) => next()
express.static = () => (_req, _res, next) => next()

module.exports = express
