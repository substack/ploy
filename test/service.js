var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var verify = require('./lib/verify');
var fs = require('fs');
var net = require('net');
var concat = require('concat-stream');

function setup (t) {
    var ps = spawn(__dirname + '/setup.sh', [ 'multi' ], {
        cwd: __dirname
    });
    ps.on('exit', t.end.bind(t));
}

function teardown (t) {
    var ps = spawn(__dirname + '/teardown.sh', [], {
        cwd: __dirname
    });
    ps.stderr.pipe(process.stderr);
    ps.on('exit', t.end.bind(t));
    t.on('end', function () {
        server.close();
        setTimeout(process.exit, 500);
    });
}

function push (branch, cb) {
    var args = [
        'push',
        'http://localhost:' + port + '/_ploy/repo.git',
        branch
    ];
    var ps = spawn('git', args, {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', cb);
}

var tmpDir = '/tmp/ploy-test/' + Math.random();
var server = ploy(tmpDir);
var port;

function pending (n, cb) {
    return function () { if (--n <= 0) cb() };
}

test(setup);
test({ timeout: 90 * 1000 }, function (t) {
    t.plan(3);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    function push0 () {
        push('master', function (code) {
            t.equal(code, 0);
            var next = pending(2, checkPort);
            
            setTimeout(function () {
                verify(port, t, 'BEEP\n', 'beep.local', next);
                verify(port, t, 'host not found\n', 'boop.local', next);
            }, 3000);
        });
    }
    
    function checkPort () {
        fs.readFile(__dirname + '/repo', function (err, src) {
            net.connect(Number(src)).pipe(concat(function (err, buf) {
                t.equal(String(buf), 'BOOP\n');
            }));
        });
    }
});
test(teardown);
