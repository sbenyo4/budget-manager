export interface PreferencePatchQueue<TPatch extends object, TResult> {
  enqueue: (patch: TPatch) => Promise<TResult>;
  discardRetries: () => void;
}

export function createPreferencePatchQueue<TPatch extends object, TResult>(
  save: (patch: TPatch) => Promise<TResult>
): PreferencePatchQueue<TPatch, TResult> {
  let tail = Promise.resolve();
  let retryPatch: TPatch = {} as TPatch;

  return {
    enqueue(patch) {
      const request = tail.then(async () => {
        const submittedPatch = { ...retryPatch, ...patch } as TPatch;
        retryPatch = {} as TPatch;
        try {
          return await save(submittedPatch);
        } catch (error) {
          retryPatch = { ...submittedPatch, ...retryPatch } as TPatch;
          throw error;
        }
      });
      tail = request.then(() => undefined, () => undefined);
      return request;
    },
    discardRetries() {
      retryPatch = {} as TPatch;
    },
  };
}
