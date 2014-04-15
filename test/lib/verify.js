var hyperquest = require('hyperquest');
var concat = require('concat-stream');

module.exports = function (port, t, msg, host, cb) {
    var times = 0;
    (function request () {
        var hq = hyperquest('http://localhost:' + port);
        hq.setHeader('host', host);
        hq.pipe(concat(function (err, body) {
            console.error('RESPONSE BODY: ' + body);
            if (String(body) === msg || ++times > 30) {
                t.equal(String(body), msg);
                if (cb) cb();
            }
            else setTimeout(request, 1000);
        }));
    })();
};
