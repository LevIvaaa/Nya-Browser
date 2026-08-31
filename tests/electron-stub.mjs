// Stand-in for the electron module so the filter engine can be tested in Node.
// Only the pieces filters.ts touches are here; the tests never go near the
// network or the on-disk cache.
export const app = { getPath: () => '/tmp/nya-test' }
export const net = {
  fetch: async () => {
    throw new Error('the filter tests must not hit the network')
  }
}
