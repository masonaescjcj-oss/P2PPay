'use strict';

class ApiError extends Error {
  // details: extra fields for the client (e.g. { max: '100' } for a limit), sent next to `error`.
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const bad = (code, msg, details) => new ApiError(400, code, msg, details);
const forbidden = (code = 'forbidden', details) => new ApiError(403, code, null, details);
const notFound = (code = 'not_found') => new ApiError(404, code);
const conflict = (code, msg, details) => new ApiError(409, code, msg, details);

module.exports = { ApiError, bad, forbidden, notFound, conflict };
