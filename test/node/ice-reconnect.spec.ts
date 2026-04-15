// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'
import initPeer from '../../packages/core/src/peer.ts'

const tick = () => new Promise(res => setTimeout(res, 0))

class MockPC {
  static all = []

  connectionState = 'new'
  signalingState = 'stable'
  iceGatheringState = 'new'
  iceConnectionState = 'new'
  localDescription = null
  onconnectionstatechange = null
  onnegotiationneeded = null
  onicecandidate = null
  ondatachannel = null
  ontrack = null
  oniceconnectionstatechange = null

  restartIceCount = 0

  constructor() {
    MockPC.all.push(this)
  }

  createDataChannel() {
    return new MockDataChannel()
  }

  async createOffer() {
    return {type: 'offer', sdp: 'v=0\r\n'}
  }

  async createAnswer() {
    return {type: 'answer', sdp: 'v=0\r\n'}
  }

  async setLocalDescription(desc) {
    this.localDescription = desc ?? {type: 'offer', sdp: 'v=0\r\n'}
    this.iceGatheringState = 'complete'
  }

  async setRemoteDescription() {}
  async addIceCandidate() {}

  restartIce() {
    this.restartIceCount++
  }

  addEventListener() {}
  removeEventListener() {}

  close() {
    this.connectionState = 'closed'
  }

  addTrack() {}
  removeTrack() {}
  getSenders() {
    return []
  }

  transitionTo(state) {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

class MockDataChannel {
  readyState = 'connecting'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  onopen = null
  onmessage = null
  onclose = null
  onerror = null
  send() {}
  close() {
    this.readyState = 'closed'
    this.onclose?.()
  }
}

const makePeer = iceReconnect =>
  initPeer(true, {
    trickleIce: true,
    rtcPolyfill: MockPC,
    iceReconnect
  })

const connect = async pc => {
  pc.transitionTo('connecting')
  pc.transitionTo('connected')
  await tick()
}

void test('Trystero iceReconnect: disabled by default', async () => {
  MockPC.all = []
  const peer = makePeer(undefined)
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  pc.transitionTo('disconnected')
  await tick()

  assert.equal(pc.restartIceCount, 0)

  peer.destroy()
})

void test('Trystero iceReconnect: fires on disconnected after connected', async () => {
  MockPC.all = []
  const peer = makePeer(true)
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  pc.transitionTo('disconnected')
  await tick()

  assert.equal(pc.restartIceCount, 1)

  peer.destroy()
})

void test('Trystero iceReconnect: fires on failed before close', async () => {
  MockPC.all = []
  let closed = false
  const peer = makePeer(true)
  peer.setHandlers({close: () => (closed = true)})
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  pc.transitionTo('failed')
  await tick()

  assert.equal(pc.restartIceCount, 1, 'failed triggers restart')
  assert.equal(closed, false, 'does not close while restart is pending')

  peer.destroy()
})

void test('Trystero iceReconnect: does NOT fire if peer never connected', async () => {
  MockPC.all = []
  let closed = false
  const peer = makePeer(true)
  peer.setHandlers({close: () => (closed = true)})
  await tick()
  const pc = MockPC.all[0]

  pc.transitionTo('failed')
  await tick()

  assert.equal(
    pc.restartIceCount,
    0,
    'restart skipped when peer never had a working path'
  )
  assert.equal(closed, true, 'fails through to normal close')
})

void test('Trystero iceReconnect: each disconnected/failed event attempts once', async () => {
  MockPC.all = []
  const peer = makePeer(true)
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  pc.transitionTo('disconnected')
  await tick()
  assert.equal(pc.restartIceCount, 1)

  pc.transitionTo('connected')
  await tick()

  pc.transitionTo('disconnected')
  await tick()
  assert.equal(pc.restartIceCount, 2)

  peer.destroy()
})

void test('Trystero iceReconnect: disabled peer closes on failed', async () => {
  MockPC.all = []
  let closed = false
  const peer = makePeer(undefined)
  peer.setHandlers({close: () => (closed = true)})
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  pc.transitionTo('failed')
  await tick()

  assert.equal(pc.restartIceCount, 0)
  assert.equal(closed, true, 'failed closes immediately when reconnect is off')
})

void test('Trystero iceReconnect: not called after peer destroyed', async () => {
  MockPC.all = []
  const peer = makePeer(true)
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  peer.destroy()

  pc.transitionTo('disconnected')
  await tick()

  assert.equal(pc.restartIceCount, 0)
})

void test('Trystero iceReconnect: non-boolean truthy values still enable', async () => {
  MockPC.all = []
  const peer = initPeer(true, {
    trickleIce: true,
    rtcPolyfill: MockPC,
    iceReconnect: 'yes'
  })
  await tick()
  const pc = MockPC.all[0]

  await connect(pc)
  pc.transitionTo('disconnected')
  await tick()

  assert.equal(pc.restartIceCount, 1)
  peer.destroy()
})
