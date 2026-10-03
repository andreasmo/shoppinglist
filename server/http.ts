export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429, message: string) {
    super(message);
  }
}
