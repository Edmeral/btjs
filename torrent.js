const fs = require('fs')
const bencode = require('bencode')
const dgram = require('dgram')
const url = require('url')
const crypto = require('crypto')

const client = dgram.createSocket('udp4')

let torrent = bencode.decode(fs.readFileSync('song.torrent'))
let tracker = url.parse(torrent.announce.toString())
let peerId = crypto.randomBytes(20) // unique 20 bytes id for this client

getPeers(tracker, peers => {
  console.log(peers[0])
})

function getPeers(tracker, cb) {
  let connectReq = makeConnectReq()
  let transactionId = connectReq.readInt32BE(12)
  client.send(connectReq, 0, connectReq.length, tracker.port, tracker.hostname)
  
  client
    .on('message', msg => { 
      let action = msg.readInt32BE(0)
      let transactionIdRes = msg.readInt32BE(4)

      // if it's is a connect response
      if (action == 0 && transactionIdRes == transactionId) {

        // Getting the connection id
        let connectionId = msg.slice(8, 16)
        
        // Sending announce request
        let announceReq = makeAnnounceReq(connectionId)
        transactionId = announceReq.readInt32BE(12)
        client.send(announceReq, 0, announceReq.length, 
          tracker.port, tracker.hostname)
      }
      
      // if it's the announce response
      else if (action == 1 && transactionIdRes == transactionId) {
        cb(getPeersFromAnnounce(msg))
      }
      else {
        console.error('Error while getting a response from the tracker')
        client.close()
      }
    })
    
    .on('error', err => {
      console.error(`Error while making connection with the tracker:\n${err.stack}`)
      client.close();
    })
  
}

function makeConnectReq() {
  let connectReq = Buffer.alloc(16)

  // Trick for writing the connection id which is a 
  // 64 bit integer (0x41727101980) by divising into 2 parts
  connectReq.writeInt32BE(0x417, 0) 
  connectReq.writeInt32BE(0x27101980, 4)

  connectReq.writeInt32BE(0, 8) // action field (0)

  crypto.randomBytes(4).copy(connectReq, 12) // 32 bits random transaction_id

  return connectReq
}

function makeAnnounceReq(connectionId) {
  let announceReq = Buffer.alloc(98)
  let zeroesBuf = Buffer.alloc(8) // 64-bit buffer filled with zeroes

  connectionId.copy(announceReq) // connection_id
  announceReq.writeInt32BE(1, 8) // action (1)
  crypto.randomBytes(4).copy(announceReq, 12) // transaction_id
  getInfoHash().copy(announceReq, 16) // info_hash
  peerId.copy(announceReq, 36) // peer_id
  zeroesBuf.copy(announceReq, 56) // downloaded (all zeroes)
  getTorrentSize().copy(announceReq, 64) // left (in this case the torrent size)
  zeroesBuf.copy(announceReq, 72) // uploaded (all zeroes)
  announceReq.writeInt32BE(0, 80) // event (0)
  announceReq.writeInt32BE(0, 84) // IP address (default: 0)
  crypto.randomBytes(4).copy(announceReq, 88) // key (random 4 bytes)
  announceReq.writeInt32BE(-1, 92) // num_want: numbers of peers wanted (default: -1) 
  announceReq.writeInt16BE(6881, 96) // port (default: 6881-6889)

  return announceReq
}

function getInfoHash() {
  let info = bencode.encode(torrent.info)
  const hash = crypto.createHash('sha1')
  hash.update(info)
  return hash.digest()
}

// Supporting only single file mode
function getTorrentSize() {
  let buf = Buffer.alloc(8)
  buf.writeInt32BE(torrent.info.length, 4) // assuming length is 32-bit at most
  return buf
}

function getPeersFromAnnounce(announceRes) {
  let peersBuf = announceRes.slice(20) 
  let peers = []
  for (let i = 0; i < peersBuf.length; i += 6) {
    let peer = { 
      ip: peersBuf.slice(i, i + 4).join('.'),
      port: peersBuf.readUInt16BE(i + 4) 
    }
    peers.push(peer)
  }
  return peers
}
