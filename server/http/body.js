import { badRequest, payloadTooLarge } from './errors.js';

/** Reads and JSON-parses a request body, enforcing a hard size ceiling. */
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > maxBytes) {
        reject(payloadTooLarge());
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();

      if (!raw) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(badRequest('Request body is not valid JSON'));
      }
    });

    req.on('error', reject);
  });
}
