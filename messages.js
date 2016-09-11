/* 
 * peer to peer messages of the bittorrent wire protocol
 */

module.exports.handshake = function(infoHash, peerId) {
  let pstrlen = Buffer.alloc(1)
  pstrlen.writeInt8(19, 0)
  return Buffer.concat([pstrlen, Buffer.from('BitTorrent protocol'), 
    Buffer.alloc(8), infoHash, peerId])
}

module.exports.interested = Buffer.from([0, 0, 0, 1, 2])

module.exports.request = function(pieceIndex, begin, length) {
  let buf = Buffer.alloc(17)
  buf.writeUInt32BE(13, 0)
  buf.writeInt8(6, 4)
  buf.writeUInt32BE(pieceIndex, 5)
  buf.writeUInt32BE(begin, 9)
  buf.writeUInt32BE(length, 13)
  return buf
}

module.exports.parse = function(msg, torrent) {
  let type
  if (msg.toString('utf8', 1, 20) == 'BitTorrent protocol' &&
    msg.slice(28, 48).equals(torrent.infoHash)) type = 'handshake'
  if (msg.length == 4 && msg.readUInt32BE(0) == 0) type = 'keepalive'
  if (msg.length >= 6 && msg.readInt8(4) == 5) type = 'bitfield'
  if (msg.length == 9 && msg.readInt8(4) == 4) type = 'have'
  if (msg.length == 5 && msg.readInt8(4) == 1) type = 'unchoke'
  if (msg.readInt8(4) == 7) type = 'piece'
  let id
  if (msg.length > 4) 
    id = msg.readInt8(4)

  let payload = msg.slice(5)

  return { type, id, payload }
}
// console.log(module.exports.interested.readUInt32BE(0), module.exports.interested.readInt8(4))