var hyperquest = require('hyperquest');
var concat = require('concat-stream');

module.exports = function (port, t, msg, host, cb) {
    var times = 0;
    var iv = setInterval(function () {
        var hq = hyperquest('http://localhost:' + port);
        hq.setHeader('host', host);
        hq.pipe(concat(function (err, body) {
            if (String(body) === msg || ++times > 15) {
                clearInterval(iv);
                t.equal(String(body), msg);
                if (cb) cb();
            }
        }));
    }, 1000);
};
