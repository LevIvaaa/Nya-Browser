// Stand-in for the electron module so main-process code can be tested in Node.
// Only the pieces the tested modules touch are here, and every one of them is
// inert: the tests never reach the network, the disk cache or a dialog.
export const app = {
  getPath: () => '/tmp/nya-test',
  getVersion: () => '0.0.0-test',
  isPackaged: false,
  whenReady: async () => undefined,
  on: () => undefined
}

export const net = {
  fetch: async () => {
    throw new Error('the tests must not hit the network')
  }
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] })
}

export const session = {
  defaultSession: {
    extensions: {
      loadExtension: async () => {
        throw new Error('no extension host in the tests')
      },
      removeExtension: () => undefined,
      getAllExtensions: () => []
    }
  }
}

export const shell = { openPath: async () => '' }
