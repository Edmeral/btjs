const net = require('net')
const torrent = require('./torrent')
const messages = require('./messages')

torrent.getPeers(torrent.tracker, peers => {

  let peer = peers[1]
  const client = net.Socket()

  // array of the pieces the peer has
  let peerHas = new Array(torrent.numPieces).fill(false)

  client.connect(peer.port, peer.ip, () => {
    console.log('Connected to peer:', peer)

    let handshake = messages.handshake(torrent.infoHash, torrent.peerId)
    console.log(handshake.length)

    client.write(handshake, () => console.log('Sent handshake'))

    waitForMessage(client, msg => {

      if (isHandshake(msg)) {
        console.log('Received handshake from peer', peer)
        console.log('pstrlen:', msg.readUInt8(0))
        console.log('pstr:', msg.slice(1, 20).toString())
        console.log('info_hash:', msg.toString('hex', 28, 48), torrent.infoHash.toString('hex'))
        console.log('peer_id:', msg.slice(38).toString('hex'), torrent.peerId.toString('hex'))
      }

      else {

        if (isKeepAliveMsg(msg))
          console.log('Just trying to keep this connection alive!')

        if (isHaveMsg(msg)) {
          let index = getPayload(msg).readUInt32BE()
          console.log('Received have message with piece Index:', index)
          peerHas[index] = true
        }

        if (isBitfieldMsg(msg)) {
          let bitfield = getPayload(msg)
          console.log('Received bitfield message with bitfield:', bitfield)
          parseBitfield(bitfield, peerHas)
        }

      }
      
    })

  })

  client.on('error', err => {
    console.log('error connecting to peer', peer)
  })
})

function waitForMessage(client, cb) {
  let savedBuffer = Buffer.alloc(0)
  let isHandshake = true

  client.on('data', msg => {
    savedBuffer = Buffer.concat([savedBuffer, msg])

    while (savedBuffer.length >= 4 && savedBuffer.length >= len()) {
      cb(savedBuffer.slice(0, len()))
      savedBuffer = savedBuffer.slice(len())
      isHandshake = false
    }
  })

  // get the length of the message we're receiving 
  function len() {
    if (isHandshake) 
      return savedBuffer.readUInt8(0) + 49
    return savedBuffer.readInt32BE(0) + 4
  }
}

// check if a received message is a handshake
function isHandshake(msg) {
  return msg.toString('utf8', 1, 20) == 'BitTorrent protocol' &&
    msg.slice(28, 48).equals(torrent.infoHash)
}

function isKeepAliveMsg(msg) {
  return msg.length == 4 && msg.readUInt32BE(0) == 0
}

function isBitfieldMsg(msg) {
  return msg.length >= 6 && msg.readInt8(4) == 5
}

function isHaveMsg(msg) {
  return msg.length == 9 && msg.readInt8(4) == 4
}

function getPayload(msg) {
  return msg.slice(5)
}

// Know which pieces the peer has based on the bitfield
function parseBitfield(bitfield, peerHas) {

  // we will populate the peerHas array by chunks of 8 elements 
  for (let byteIndex = 0; byteIndex < bitfield.length; byteIndex++) {
    let byte = bitfield.readInt8(byteIndex)
    
    // position of the piece in the array
    // we start by the least significant bit
    let i = 7 + byteIndex * 8

    // if we're at last byte, we shouldn't 
    // consider bits located beyond numPieces
    if (byteIndex == bitfield.length - 1) {
      let diff = 8 * bitfield.length - torrent.numPieces
      byte = byte >> diff
      i -= diff
    }

    for (; i >= byteIndex * 8; i--) {
      let res = byte & 1 ? true : false
      peerHas[i] = res
      byte = byte >> 1
    }

  }

  return peerHas
}
