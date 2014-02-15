var http = require('http');
var server = http.createServer(function (req, res) {
    res.end('beep boop?\n');
});

var port = process.argv[2] || process.env.PORT;
server.listen(port);
