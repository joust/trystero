const CHUNK_SIZE = 64 * 1024

export const createFileTransfer = room => {
  const [sendMan, getMan] = room.makeAction('fileMan')
  const [sendHave, getHave] = room.makeAction('fileHave')
  const [sendChunk, getChunk] = room.makeAction('fileChunk')

  const received = new Map()
  const pending = new Map()
  const listeners = {
    onFile: () => {},
    onProgress: () => {}
  }

  getMan((manifest, peerId) => {
    const entry = received.get(manifest.fileId) ?? {
      manifest,
      chunks: new Map()
    }
    entry.manifest = manifest
    received.set(manifest.fileId, entry)

    sendHave(
      {fileId: manifest.fileId, have: [...entry.chunks.keys()]},
      peerId
    )
  })

  getHave(async ({fileId, have}, peerId) => {
    const send = pending.get(fileId)
    if (!send) return

    const already = new Set(have)
    send.sent = already.size
    listeners.onProgress({
      direction: 'send',
      fileId,
      peerId,
      sent: send.sent,
      total: send.total
    })

    for (let i = 0; i < send.total; i++) {
      if (send.aborted) return
      if (already.has(i)) continue

      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, send.buffer.byteLength)
      const chunk = send.buffer.slice(start, end)

      await sendChunk(chunk, peerId, {fileId, idx: i})

      send.sent++
      listeners.onProgress({
        direction: 'send',
        fileId,
        peerId,
        sent: send.sent,
        total: send.total
      })
    }

    if (!send.aborted) {
      pending.delete(fileId)
      send.resolve()
    }
  })

  getChunk((data, peerId, meta) => {
    const {fileId, idx} = meta ?? {}
    if (fileId === undefined) return

    const entry = received.get(fileId)
    if (!entry) return

    entry.chunks.set(idx, data)

    listeners.onProgress({
      direction: 'receive',
      fileId,
      peerId,
      sent: entry.chunks.size,
      total: entry.manifest.totalChunks
    })

    if (entry.chunks.size !== entry.manifest.totalChunks) return

    const parts = []
    for (let i = 0; i < entry.manifest.totalChunks; i++) {
      parts.push(entry.chunks.get(i))
    }

    received.delete(fileId)
    listeners.onFile({
      fileId,
      name: entry.manifest.name,
      blob: new Blob(parts),
      peerId
    })
  })

  return {
    send: (fileId, name, buffer, targetPeers) => {
      const existing = pending.get(fileId)
      if (existing) {
        existing.aborted = true
        existing.resolve({aborted: true})
      }

      const total = Math.ceil(buffer.byteLength / CHUNK_SIZE) || 1
      const manifest = {
        fileId,
        name,
        totalSize: buffer.byteLength,
        totalChunks: total,
        chunkSize: CHUNK_SIZE
      }

      return new Promise((resolve, reject) => {
        pending.set(fileId, {
          buffer,
          total,
          sent: 0,
          aborted: false,
          resolve,
          reject
        })
        sendMan(manifest, targetPeers)
      })
    },

    abort: fileId => {
      const s = pending.get(fileId)
      if (s) {
        s.aborted = true
        pending.delete(fileId)
        s.resolve({aborted: true})
      }
    },

    drop: fileId => {
      received.delete(fileId)
    },

    peek: fileId => {
      const entry = received.get(fileId)
      if (!entry) return null
      return {
        name: entry.manifest.name,
        have: entry.chunks.size,
        total: entry.manifest.totalChunks
      }
    },

    onFile: f => (listeners.onFile = f),
    onProgress: f => (listeners.onProgress = f)
  }
}
