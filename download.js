const net = require('net')
const torrent = require('./torrent')
const messages = require('./messages')
const utils = require('./utils')
const fs = require('fs')
const ProgressBar = require('progress')

const BLOCK_LEN = 16384 // 2^14
const file = fs.openSync(torrent.info.name, 'w')

// Keeping track of the pieces that are requested and those received
let requested = new Array(torrent.numPieces).fill(false)
let received = new Array(torrent.numPieces).fill(false)

// Array of arrays, each contains how many blocks has been received
let receivedBlocks = new Array(torrent.numPieces)
for (let i = 0; i < receivedBlocks.length; i++) {
  receivedBlocks[i] = new Array(getNumBlocksForPiece(i)).fill(false)
}

// Actual pieces, each one is a buffer
let pieces = new Array(torrent.numPieces)
for (let i = 0; i < pieces.length; i++) {
  pieces[i] = Buffer.alloc(getPieceLength(i))
}

console.log(`Downloading ${torrent.info.name} ..`)

let piecesCounter = 0
let progressBar = new ProgressBar(`[:bar] :percent :elapseds :pieces pieces`, {
    complete: '=',
    incomplete: ' ',
    width: 40,
    total: torrent.numPieces
  });

torrent.getPeers(torrent.tracker, peers => {
  console.log('We have ' + peers.length + ' peers')

  for (let peer of peers) {

    const client = net.Socket()

    // array of the pieces the peer has
    let peerHas = []

    peer.choking = true
    peer.interested = false

    let timeout = setTimeout(() => { 
      console.log('Connection timeout', peer.ip)
      client.destroy()
    }, 5000)

    client.connect(peer.port, peer.ip, () => {
      clearTimeout(timeout)

      console.log('Connected to peer:', peer.ip)

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

        if (msg.type == 'keepalive')
          console.log('Just trying to keep this connection alive!')

        if (msg.type == 'have') {
          let index = msg.payload.readUInt32BE()
          console.log('Received have message with piece Index:', index)
          peerHas.push(index)
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
          // it seems that the `unchoke` message is sent only after
          // sending all `have' messages
          if (peer.interested && !peer.choking) {
            requestPiece(client, peerHas)
          }
        }
        
        if (msg.type == 'piece')
          handleBlock(client, peerHas, msg)

      })

    })

    client.on('error', err => {
      console.log('error connecting to peer', peer)
    })
  }
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
      if (res) peerHas.push(i)
      byte = byte >> 1
    }
  }

  return peerHas
}

function requestPiece(client, peerHas) {
  if (peerHas.length == 0)
    return 

  let pieceIndex = peerHas.pop()

  if (requested[pieceIndex] || received[pieceIndex])
    return requestPiece(client, peerHas) 

  requested[pieceIndex] = true

  let pieceLength
  if (pieceIndex == torrent.numPieces - 1) // last piece
    pieceLength = torrent.info.length % torrent.info['piece length']
  else
    pieceLength = torrent.info['piece length']

  let blocks = Math.floor(pieceLength / BLOCK_LEN)
  let lastBlockLen = pieceLength % BLOCK_LEN

  console.log(`Requesting piece n ${pieceIndex}`)

  for (let i = 0; i < blocks; i++) {
    let begin = i * BLOCK_LEN
    let length = BLOCK_LEN
    requestBlock(client, pieceIndex, begin, length)
  }

  if (lastBlockLen > 0)
    requestBlock(client, pieceIndex, blocks, lastBlockLen)
}

function requestBlock(client, pieceIndex, begin, length) {
  let reqBuf = messages.request(pieceIndex, begin, length)
  client.write(reqBuf, () => console.log('Requested a block', pieceIndex, begin, length))
}

function handleBlock(client, peerHas, msg) {
  let pieceIndex = msg.payload.readInt32BE(0)
  let begin = msg.payload.readInt32BE(4)
  let block = msg.payload.slice(8)
  // console.log('received a block ', pieceIndex, begin, block.length)

  let blockIndex = getBlockIndex(pieceIndex, begin)
  receivedBlocks[pieceIndex][blockIndex] = true
  block.copy(pieces[pieceIndex], begin)

  // Piece is done
  if (receivedBlocks[pieceIndex].every(block => block) && !received[pieceIndex]) {
    console.log('Received whole Piece', pieceIndex)

    // Verify hash
    let pieceHash = utils.getHash(pieces[pieceIndex])

    if (torrent.getPieceHash(pieceIndex).equals(pieceHash)) {
      console.log('Hashes are equals Saving piece to the file', pieceIndex)
      piecesCounter++
      progressBar.tick({ pieces: `${piecesCounter}/${torrent.numPieces}`})

      // mark piece as received
      received[pieceIndex] = true

      // Save piece to file
      let offset = pieceIndex * torrent.info['piece length']
      fs.write(file, pieces[pieceIndex], 0, pieces[pieceIndex].length, offset)
      // console.log('received', piecesCounter)
      // File is Done
      if (received.every(piece => piece)) {
        console.log('Received whole File')
        client.end()
        process.exit()
      }
      // We still need to download some stuff
      // else {
      //   requested = received.slice()
      // }

      if (torrent.numPieces - piecesCounter < 10) // end game
        requested = received.slice()

      // request next Piece from client
      requestPiece(client, peerHas)
    }
    else {
      receivedBlocks[pieceIndex] = receivedBlocks[pieceIndex].map(x => false)
      received[pieceIndex] = false
      requested[pieceIndex] = false
    }
 }
}

function getPieceLength(pieceIndex) {
  let pieceLength
  if (pieceIndex == torrent.numPieces - 1) // last piece
    pieceLength = torrent.info.length % torrent.info['piece length']
  else
    pieceLength = torrent.info['piece length']

  return pieceLength
}

function getNumBlocksForPiece(pieceIndex) {
  let pieceLength = getPieceLength(pieceIndex)
  return Math.ceil(pieceLength / BLOCK_LEN)
}

function getBlockIndex(pieceIndex, begin) {
  let pieceLength = getPieceLength(pieceIndex)
  return begin / BLOCK_LEN
} 

function getBlockLength(pieceIndex, blockIndex) {

}