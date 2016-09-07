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
        if (isKeepAlive(msg))
          console.log('Just trying to keep this connection alive!')
        else {
          let len = msg.readUInt32BE(0)
          console.log('Received some message with id: ', msg.readUInt8(4), ' and len', len)
        }
      }
      
    })

  })

  // client.on('data', data => {
  //   console.log('Got data from ', peer)
  // })

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

function isKeepAlive(msg) {
  return msg.length == 4 && msg.readUInt32BE(0) == 0
}