export interface StorageDriver {
  /** Store an object under `key` (e.g. `products/<uuid>.png`). */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** URL for objects that are meant to be public (product photos). */
  publicUrl(key: string): Promise<string> | string;
  /** Short-lived URL for private objects (payment proofs). */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Remove an object. Missing objects are not an error. */
  delete(key: string): Promise<void>;
}
