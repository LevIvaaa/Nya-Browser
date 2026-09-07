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

// A stand-in for the OS keychain: reversible, in-process, and worth nothing as
// protection. The real one is DPAPI, which is per-machine and per-account and
// therefore not something a test may touch. Saying it is unavailable instead
// would leave the whole keychain-backed path — the one the browser uses by
// default — untested.
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from('nya-test:' + text, 'utf8'),
  decryptString: (buffer) => {
    const text = Buffer.from(buffer).toString('utf8')
    if (!text.startsWith('nya-test:')) throw new Error('not sealed by this stub')
    return text.slice('nya-test:'.length)
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
