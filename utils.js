const crypto = require('crypto')

module.exports.getHash = function(buf) {
  const hash = crypto.createHash('sha1')
  hash.update(buf)
  return hash.digest()
}

module.exports.debug = function(active) {
  return (...args) => {
    if (active) 
      console.log(...args)
  }
  
}