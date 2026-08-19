export function makeMockBrowser() {
  const local: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};

  return {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: local[key] }),
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
        get: (key: string) => Promise.resolve({ [key]: sync[key] }),
        set: (items: Record<string, unknown>) => {
          Object.assign(sync, items);
          return Promise.resolve();
        },
      },
    },
  };
}
