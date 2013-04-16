var net = require('net');
var fs = require('fs');

var server = net.createServer(function (stream) {
    stream.end('BOOP\n');
});

server.listen(function () {
    fs.writeFile(__dirname + '/port.txt', String(server.address().port));
});
