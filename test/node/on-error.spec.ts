// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'
import room from '../../packages/core/src/room.ts'

const tick = () => new Promise(res => setTimeout(res, 0))

class MockPeer {
  created = Date.now()
  connection = {}
  channel = null
  isDead = false
  handlers = {}
  offerPromise = Promise.resolve()

  async getOffer() {}
  async signal() {}
  sendData() {}

  destroy() {
    if (this.isDead) return
    this.isDead = true
    this.handlers.close?.()
  }

  setHandlers(newHandlers) {
    Object.assign(this.handlers, newHandlers)
  }

  addStream() {}
  removeStream() {}
  addTrack() {}
  removeTrack() {}
  replaceTrack() {}
}

void test('Trystero onError: fires for peer-level RTC errors', async () => {
  let registerPeer = null
  const errors = []
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {}
  )

  roomRef.onError(e => errors.push(e))

  const peer = new MockPeer()
  registerPeer(peer, 'peer-x')
  await tick()

  const boom = new Error('ICE connection lost')
  peer.handlers.error?.(boom)

  assert.equal(errors.length, 1)
  assert.equal(errors[0].code, 'peer')
  assert.equal(errors[0].peerId, 'peer-x')
  assert.equal(errors[0].error, boom)

  await roomRef.leave()
})

void test('Trystero onError: fires for handshake timeouts', async () => {
  let registerPeer = null
  const errors = []
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {},
    {
      handshakeTimeoutMs: 20,
      onPeerHandshake: () => new Promise(() => {})
    }
  )

  roomRef.onError(e => errors.push(e))

  const peer = new MockPeer()
  registerPeer(peer, 'peer-hs')

  await new Promise(res => setTimeout(res, 50))

  assert.equal(errors.length, 1)
  assert.equal(errors[0].code, 'handshake')
  assert.equal(errors[0].peerId, 'peer-hs')
  assert.match(errors[0].error.message, /handshake/i)

  await roomRef.leave()
})

void test('Trystero onError: fires for sends to unknown peers', async () => {
  const errors = []
  const roomRef = room(
    () => {},
    () => {},
    () => {}
  )

  roomRef.onError(e => errors.push(e))

  const [sendFoo] = roomRef.makeAction('foo')
  await sendFoo('hi', 'ghost-peer')

  const actionErrors = errors.filter(e => e.code === 'action')
  assert.equal(actionErrors.length, 1)
  assert.equal(actionErrors[0].peerId, 'ghost-peer')
  assert.match(actionErrors[0].error.message, /no peer/i)

  await roomRef.leave()
})

void test('Trystero onError: handler throwing does not break room', async () => {
  let registerPeer = null
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {}
  )

  roomRef.onError(() => {
    throw new Error('bad handler')
  })

  const peer = new MockPeer()
  registerPeer(peer, 'peer-t')
  await tick()

  peer.handlers.error?.(new Error('underlying'))

  await roomRef.leave()
})

void test('Trystero onError: not called when no handler registered', async () => {
  let registerPeer = null
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {}
  )

  const peer = new MockPeer()
  registerPeer(peer, 'peer-n')
  await tick()

  peer.handlers.error?.(new Error('no listener'))

  await roomRef.leave()
})

void test('Trystero onError: does not fire for internal action races', async () => {
  const errors = []
  const roomRef = room(
    () => {},
    () => {},
    () => {}
  )

  roomRef.onError(e => errors.push(e))

  const [sendInternal] = roomRef.makeAction('@_fake')
  await sendInternal('hi', 'ghost-peer')

  const [sendUser] = roomRef.makeAction('user-action')
  await sendUser('hi', 'ghost-peer')

  const actionErrors = errors.filter(e => e.code === 'action')
  assert.equal(
    actionErrors.length,
    1,
    'internal actions must not trigger onError'
  )
  assert.equal(actionErrors[0].peerId, 'ghost-peer')

  await roomRef.leave()
})

void test('Trystero onError: peer error does not double-fire with close', async () => {
  let registerPeer = null
  const errors = []
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {}
  )

  roomRef.onError(e => errors.push(e))

  const peer = new MockPeer()
  registerPeer(peer, 'peer-d')
  await tick()

  peer.handlers.error?.(new Error('rtc went down'))

  assert.equal(
    errors.length,
    1,
    `exactly one error expected, got ${errors.length}`
  )
  assert.equal(errors[0].code, 'peer')

  await roomRef.leave()
})

void test('Trystero onError: suppresses console noise when listener registered', async () => {
  let registerPeer = null
  const origErr = console.error
  const origWarn = console.warn
  const logged = []
  console.error = (...args) => logged.push(['error', ...args])
  console.warn = (...args) => logged.push(['warn', ...args])

  try {
    const roomRef = room(
      f => {
        registerPeer = f
      },
      () => {},
      () => {}
    )

    roomRef.onError(() => {})

    const peer = new MockPeer()
    registerPeer(peer, 'peer-s')
    await tick()
    peer.handlers.error?.(new Error('rtc'))

    const [sendUser] = roomRef.makeAction('user-action')
    await sendUser('hi', 'ghost-peer')

    assert.equal(
      logged.length,
      0,
      `expected no console noise, got: ${JSON.stringify(logged)}`
    )

    await roomRef.leave()
  } finally {
    console.error = origErr
    console.warn = origWarn
  }
})

void test('Trystero onError: room still usable after throwing handler', async () => {
  let registerPeer = null
  const goodErrors = []
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {}
  )

  let throwNext = true
  roomRef.onError(e => {
    if (throwNext) {
      throwNext = false
      throw new Error('bad handler')
    }
    goodErrors.push(e)
  })

  const peerA = new MockPeer()
  registerPeer(peerA, 'peer-a')
  await tick()
  peerA.handlers.error?.(new Error('first'))

  const peerB = new MockPeer()
  registerPeer(peerB, 'peer-b')
  await tick()
  peerB.handlers.error?.(new Error('second'))

  assert.equal(goodErrors.length, 1)
  assert.equal(goodErrors[0].peerId, 'peer-b')
  assert.equal(goodErrors[0].error.message, 'second')

  await roomRef.leave()
})
