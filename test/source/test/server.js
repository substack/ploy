var http = require('http');
var fs = require('fs');

var src;
try {
  src = fs.readFileSync(__dirname + '/file.txt');
}
catch (e) {
  if (e.code !== "ENOENT") {
    throw e;
  }
}

var server = http.createServer(function (req, res) {
    res.end(src);
});

var port = process.argv[2] || process.env.PORT;
server.listen(port);
