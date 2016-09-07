/* 
 * peer to peer messages of the bittorrent wire protocol
 */

module.exports.handshake = function(infoHash, peerId) {
  let pstrlen = Buffer.alloc(1)
  pstrlen.writeUInt8(19, 0)
  return Buffer.concat([pstrlen, Buffer.from('BitTorrent protocol'), 
    Buffer.alloc(8), infoHash, peerId])
}