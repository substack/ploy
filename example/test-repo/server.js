var http = require('http');
var server = http.createServer(function (req, res) {
    res.end('BEEP!\n');
});

var port = process.argv[2] || process.env.PORT;
server.listen(port);
