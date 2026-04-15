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
  destroyCount = 0
  offerPromise = Promise.resolve()

  async getOffer() {}
  async signal() {}
  sendData() {}

  destroy() {
    if (this.isDead) return
    this.isDead = true
    this.destroyCount += 1
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

void test('Trystero maxPeers: rejects connections past the limit', async () => {
  let registerPeer = null
  const strategyLeaves = []
  const roomRef = room(
    f => {
      registerPeer = f
    },
    id => strategyLeaves.push(id),
    () => {},
    {maxPeers: 2}
  )

  const p1 = new MockPeer()
  const p2 = new MockPeer()
  const p3 = new MockPeer()

  registerPeer(p1, 'peer-1')
  registerPeer(p2, 'peer-2')
  registerPeer(p3, 'peer-3')

  await tick()

  assert.equal(p1.destroyCount, 0, 'first peer under limit stays alive')
  assert.equal(p2.destroyCount, 0, 'second peer at limit stays alive')
  assert.equal(p3.destroyCount, 1, 'third peer past limit is destroyed')
  assert.deepEqual(
    strategyLeaves,
    ['peer-3'],
    'strategy is notified the rejected peer has left'
  )

  await roomRef.leave()
})

void test('Trystero maxPeers: allows replacement of existing peer id', async () => {
  let registerPeer = null
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {},
    {maxPeers: 1}
  )

  const p1 = new MockPeer()
  registerPeer(p1, 'peer-1')
  await tick()
  assert.equal(p1.destroyCount, 0)

  const p1b = new MockPeer()
  registerPeer(p1b, 'peer-1')
  await tick()

  assert.equal(p1.destroyCount, 1, 'old handle is replaced (destroyed)')
  assert.equal(p1b.destroyCount, 0, 'replacement handle is live')

  await roomRef.leave()
})

void test('Trystero maxPeers: slot freed on peer leave admits new peer', async () => {
  let registerPeer = null
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {},
    {maxPeers: 1}
  )

  const p1 = new MockPeer()
  registerPeer(p1, 'peer-1')
  await tick()

  p1.handlers.close?.()

  const p2 = new MockPeer()
  registerPeer(p2, 'peer-2')
  await tick()

  assert.equal(p2.destroyCount, 0, 'new peer admitted after slot freed')

  await roomRef.leave()
})

void test('Trystero maxPeers: undefined means unlimited', async () => {
  let registerPeer = null
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {}
  )

  const peers = []
  for (let i = 0; i < 10; i++) {
    const p = new MockPeer()
    peers.push(p)
    registerPeer(p, `peer-${i}`)
  }

  await tick()

  assert.ok(
    peers.every(p => p.destroyCount === 0),
    'no peer rejected when maxPeers is not set'
  )

  await roomRef.leave()
})

void test('Trystero maxPeers: validates input', () => {
  assert.throws(
    () =>
      room(
        () => {},
        () => {},
        () => {},
        {maxPeers: -1}
      ),
    /maxPeers must be a non-negative integer/
  )

  assert.throws(
    () =>
      room(
        () => {},
        () => {},
        () => {},
        {maxPeers: 3.14}
      ),
    /maxPeers must be a non-negative integer/
  )

  assert.throws(
    () =>
      room(
        () => {},
        () => {},
        () => {},
        {maxPeers: Infinity}
      ),
    /maxPeers must be a non-negative integer/
  )

  const r = room(
    () => {},
    () => {},
    () => {},
    {maxPeers: 0}
  )
  r.leave()
})

void test('Trystero maxPeers: onPeerJoin does not fire for rejected peer', async () => {
  let registerPeer = null
  const joins = []
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {},
    {maxPeers: 1}
  )

  roomRef.onPeerJoin(id => joins.push(id))

  const encoder = new TextEncoder()
  const hsready = new Uint8Array(36)
  hsready.set(encoder.encode('@_hsready'))
  hsready[34] = 1
  hsready[35] = 0xff

  const p1 = new MockPeer()
  registerPeer(p1, 'peer-1')
  await tick()
  p1.handlers.data?.(hsready.buffer)
  await tick()

  const p2 = new MockPeer()
  registerPeer(p2, 'peer-2')
  await tick()
  p2.handlers.data?.(hsready.buffer)
  await tick()

  assert.deepEqual(joins, ['peer-1'], 'only the admitted peer joined')
  assert.equal(p2.destroyCount, 1)

  await roomRef.leave()
})

void test('Trystero maxPeers: zero rejects everything', async () => {
  let registerPeer = null
  const roomRef = room(
    f => {
      registerPeer = f
    },
    () => {},
    () => {},
    {maxPeers: 0}
  )

  const p = new MockPeer()
  registerPeer(p, 'peer-1')
  await tick()

  assert.equal(p.destroyCount, 1)

  await roomRef.leave()
})
