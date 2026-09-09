/** An error carrying an HTTP status, safe to surface to the client. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const payloadTooLarge = (message = 'Request body too large') => new HttpError(413, message);
