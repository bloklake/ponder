import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "./promiseWithResolvers.js";

export const createLock = (): {
  lock: () => Promise<void>;
  /** Acquire the lock synchronously if it is free. */
  tryLock: () => boolean;
  unlock: () => void;
} => {
  const queue: PromiseWithResolvers<void>[] = [];
  let locked = false;

  return {
    lock: async () => {
      if (locked === false) {
        locked = true;
        return;
      }

      const pwr = promiseWithResolvers<void>();
      queue.push(pwr);
      return pwr.promise;
    },
    tryLock: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    unlock: () => {
      if (queue.length > 0) {
        const pwr = queue.shift()!;
        pwr.resolve();
      } else {
        locked = false;
      }
    },
  };
};
