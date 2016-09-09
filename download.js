const net = require('net')
const torrent = require('./torrent')
const messages = require('./messages')

// Keeping track of the pieces that are requested
let requested = new Array(torrent.numPieces).fill(false)

torrent.getPeers(torrent.tracker, peers => {

  let peer = peers[1]
  const client = net.Socket()

  // array of the pieces the peer has
  let peerHas = new Array(torrent.numPieces).fill(false)

  peer.choking = true
  peer.interested = false

  client.connect(peer.port, peer.ip, () => {
    console.log('Connected to peer:', peer)

    let handshake = messages.handshake(torrent.infoHash, torrent.peerId)
    console.log('Handshake buffer length', handshake.length)

    client.write(handshake, () => console.log('Sent handshake'))

    waitForMessage(client, msg => {
      msg = messages.parse(msg, torrent)

      if (msg.type == 'handshake') {
        console.log('Received handshake from peer')

        console.log('Will new send interested message..')
        peer.interested = true
        client.write(messages.interested, () => console.log('Sent interested'))
        // console.log('pstrlen:', msg.readUInt8(0))
        // console.log('pstr:', msg.slice(1, 20).toString())
        // console.log('info_hash:', msg.toString('hex', 28, 48), torrent.infoHash.toString('hex'))
        // console.log('peer_id:', msg.slice(38).toString('hex'), torrent.peerId.toString('hex'))
      }

      else {

        if (msg.type == 'keepalive')
          console.log('Just trying to keep this connection alive!')

        if (msg.type == 'have') {
          let index = msg.payload.readUInt32BE()
          console.log('Received have message with piece Index:', index)
          peerHas[index] = true
        }

        if (msg.type == 'bitfield') {
          let bitfield = msg.payload
          console.log('Received bitfield message with bitfield:', bitfield)
          parseBitfield(bitfield, peerHas)
        }

        if (msg.type == 'unchoke') {
          console.log('The peer has unchoked us! wohoo!')
          peer.choking = false
          // Now we can request pieces, but we should do that after 
          // all `have` messages are received but how can we know that?
          if (peer.interested && !peer.choking) {
            console.log('requesting some piece')
            // for (piece in peerHas) {
            //   if (!requested[piece]) {
            //     request(piece)
            //     requested[piec] = true
            //   }
            //   if (failed)
            //     requested[piec] = false
            // }
          }
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
