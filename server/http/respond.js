import { HttpError } from './errors.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id'
};

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...CORS_HEADERS
  });
  res.end(body);
}

export function sendNoContent(res, status = 204) {
  res.writeHead(status, CORS_HEADERS);
  res.end();
}

/**
 * Translates a thrown value into a response. Only HttpError messages are
 * echoed back; anything else is logged and reported as a generic 500.
 */
export function sendError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message, details: error.details });
    return;
  }

  console.error('[the-wait] unhandled error:', error);
  sendJson(res, 500, { error: 'Internal server error' });
}
