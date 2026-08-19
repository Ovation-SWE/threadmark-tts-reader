export function makeMockBrowser() {
  const local: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};

  const resolveGet = (store: Record<string, unknown>, key: string | string[]) => {
    const keys = Array.isArray(key) ? key : [key];
    return Promise.resolve(Object.fromEntries(keys.map(k => [k, store[k]])));
  };

  return {
    storage: {
      local: {
        get: (key: string | string[]) => resolveGet(local, key),
        set: (items: Record<string, unknown>) => {
          Object.assign(local, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          delete local[key];
          return Promise.resolve();
        },
      },
      sync: {
        get: (key: string | string[]) => resolveGet(sync, key),
        set: (items: Record<string, unknown>) => {
          Object.assign(sync, items);
          return Promise.resolve();
        },
      },
    },
  };
}
