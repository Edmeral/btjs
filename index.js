const torrent = require('./torrent')(process.argv[2])
const download = require('./download')
download(torrent)