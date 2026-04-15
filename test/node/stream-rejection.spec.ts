// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'
import room from '../../packages/core/src/room.ts'

const tick = () => new Promise(res => setTimeout(res, 0))

class LinkedPeer {
  created = Date.now()
  connection = {}
  channel = {
    readyState: 'open',
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0
  }
  isDead = false
  handlers = {}
  offerPromise = Promise.resolve()
  partner = null
  sendCount = 0

  async getOffer() {}
  async signal() {}

  sendData(data) {
    this.sendCount++
    this.partner?.handlers.data?.(data.slice().buffer)
  }

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

const createJoinedRooms = async () => {
  let registerPeerA = null
  let registerPeerB = null
  const roomA = room(
    f => {
      registerPeerA = f
    },
    () => {},
    () => {}
  )
  const roomB = room(
    f => {
      registerPeerB = f
    },
    () => {},
    () => {}
  )
  const joinA = new Promise(resolve => roomA.onPeerJoin(resolve))
  const joinB = new Promise(resolve => roomB.onPeerJoin(resolve))
  const peerA = new LinkedPeer()
  const peerB = new LinkedPeer()

  peerA.partner = peerB
  peerB.partner = peerA

  registerPeerA(peerA, 'peer-b')
  registerPeerB(peerB, 'peer-a')

  await Promise.all([joinA, joinB])

  return {roomA, roomB, peerA, peerB}
}

const bigBlob = size => {
  const buf = new Uint8Array(size)
  for (let i = 0; i < size; i++) buf[i] = i & 0xff
  return buf.buffer
}

void test('Trystero stream rejection: receiver abort drops message', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('file')
    const [, receiveFile, onFileProgress] = roomB.makeAction('file')

    let delivered = false
    receiveFile(() => {
      delivered = true
    })

    const progressCalls = []
    onFileProgress((pct, peerId, meta) => {
      progressCalls.push({pct, peerId, meta})
      if (pct > 0.3) return false
    })

    await sendFile(bigBlob(160 * 1024), 'peer-b', {name: 'song.mp3'})

    await tick()

    assert.equal(delivered, false, 'aborted message must not be delivered')
    assert.ok(progressCalls.length >= 2, 'progress should fire multiple times')
    assert.equal(
      progressCalls[0].meta.name,
      'song.mp3',
      'metadata should be delivered with progress'
    )
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: returning undefined lets transfer complete', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('okfile')
    const [, receiveFile, onFileProgress] = roomB.makeAction('okfile')

    const delivered = new Promise(resolve =>
      receiveFile(payload => resolve(payload))
    )

    onFileProgress(() => {})

    const payload = bigBlob(50 * 1024)
    await sendFile(payload)

    const got = await delivered
    assert.equal(got.byteLength, payload.byteLength)
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: sender can abort via progress callback', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('bigfile')
    const [, receiveFile] = roomB.makeAction('bigfile')

    let delivered = false
    receiveFile(() => {
      delivered = true
    })

    let sendCalls = 0
    await sendFile(bigBlob(200 * 1024), 'peer-b', undefined, (pct, peerId) => {
      sendCalls++
      assert.equal(peerId, 'peer-b')
      if (pct > 0.2) return false
    })

    await tick()

    assert.ok(
      sendCalls >= 2,
      'send progress must fire at least twice before abort'
    )
    assert.equal(
      delivered,
      false,
      'receiver must not assemble aborted partial message'
    )
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: aborting one message does not affect the next', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('series')
    const [, receiveFile, onFileProgress] = roomB.makeAction('series')

    const received = []
    receiveFile((payload, _, meta) =>
      received.push({size: payload.byteLength, meta})
    )

    let abortNext = true
    onFileProgress((_, __, meta) => {
      if (abortNext && meta?.rejectMe) return false
    })

    await sendFile(bigBlob(80 * 1024), 'peer-b', {rejectMe: true})
    abortNext = false
    await sendFile(bigBlob(40 * 1024), 'peer-b', {rejectMe: false})

    await tick()

    assert.equal(received.length, 1, 'only the second message should arrive')
    assert.equal(received[0].size, 40 * 1024)
    assert.equal(received[0].meta.rejectMe, false)
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: receiver abort stops sender via cancel chunk', async () => {
  const {roomA, roomB, peerA} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('stop-me')
    const [, , onFileProgress] = roomB.makeAction('stop-me')

    onFileProgress(pct => {
      if (pct > 0.2) return false
    })

    const senderProgress = []
    await sendFile(bigBlob(200 * 1024), 'peer-b', undefined, pct => {
      senderProgress.push(pct)
    })

    assert.ok(
      senderProgress.length < 13,
      `sender should stop early; got ${senderProgress.length} progress calls`
    )
    assert.ok(
      senderProgress[senderProgress.length - 1] < 1,
      'sender must not have sent the final chunk'
    )

    assert.ok(
      peerA.sendCount < 13,
      `peerA sent too many chunks: ${peerA.sendCount}`
    )
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: sender abort cleans up receiver state', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('cleanup')
    const [, receiveFile] = roomB.makeAction('cleanup')

    const delivered = []
    receiveFile((payload, _, meta) =>
      delivered.push({size: payload.byteLength, meta})
    )

    await sendFile(bigBlob(200 * 1024), 'peer-b', {tag: 'first'}, pct =>
      pct > 0.2 ? false : undefined
    )

    await sendFile(bigBlob(40 * 1024), 'peer-b', {tag: 'second'})

    await tick()

    assert.equal(delivered.length, 1, 'only the completed send should arrive')
    assert.equal(delivered[0].meta.tag, 'second')
    assert.equal(delivered[0].size, 40 * 1024)
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: abort on last chunk does not deliver', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('lastchunk')
    const [, receiveFile, onFileProgress] = roomB.makeAction('lastchunk')

    let delivered = false
    receiveFile(() => {
      delivered = true
    })

    onFileProgress(pct => (pct >= 1 ? false : undefined))

    await sendFile(bigBlob(50 * 1024), 'peer-b')

    await tick()

    assert.equal(delivered, false, 'abort on final chunk must prevent delivery')
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})

void test('Trystero stream rejection: abort without metadata works', async () => {
  const {roomA, roomB} = await createJoinedRooms()

  try {
    const [sendFile] = roomA.makeAction('nometa')
    const [, receiveFile, onFileProgress] = roomB.makeAction('nometa')

    let delivered = false
    receiveFile(() => {
      delivered = true
    })

    onFileProgress((pct, _, meta) => {
      assert.equal(meta, undefined, 'meta must be undefined when none sent')
      if (pct > 0.3) return false
    })

    await sendFile(bigBlob(120 * 1024), 'peer-b')

    await tick()

    assert.equal(delivered, false)
  } finally {
    await Promise.all([roomA.leave(), roomB.leave()])
  }
})
