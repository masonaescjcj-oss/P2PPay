'use strict';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const bad = (code, msg) => new ApiError(400, code, msg);
const forbidden = (code = 'forbidden') => new ApiError(403, code);
const notFound = (code = 'not_found') => new ApiError(404, code);
const conflict = (code, msg) => new ApiError(409, code, msg);

module.exports = { ApiError, bad, forbidden, notFound, conflict };
