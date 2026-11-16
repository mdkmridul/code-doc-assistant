/** The client sent a source we will never accept (bad URL, not a zip, zip too big). → 400 */
export class InvalidSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSourceError';
  }
}

/** The source looks valid but cannot be reached (missing or private repo). → 422 */
export class SourceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceUnavailableError';
  }
}
