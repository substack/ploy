var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var hyperquest = require('hyperquest');
var concat = require('concat-stream');

function setup (t) {
    var ps = spawn(__dirname + '/setup.sh', [], {
        cwd: __dirname
    });
    ps.on('exit', t.end.bind(t));
}

function teardown (t) {
    var ps = spawn(__dirname + '/teardown.sh', [], {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', t.end.bind(t));
}

function commit (cb) {
    var ps = spawn(__dirname + '/commit.sh', [], {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', cb);
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

var tmpDir = path.join('/tmp', Math.random());
var server = ploy(tmpDir);
var port;
var request = require('request');

test(setup);
test(function (t) {
    t.plan(2);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    function push0 () {
        push('master', function (code) {
            t.equal(code, 0);
            setTimeout(function () {
                verify('beep boop\n', 'localhost', deploy);
            }, 10 * 3000);
        });
    }
    
    function push1 () {
        push('staging', function (code) {
            t.equal(code, 0);
            setTimeout(function () {
                verify('oh hello\n', 'staging');
            }, 3000);
        });
    }
    
    function deploy () {
        commit(function (code) {
            t.equal(code, 0);
            setTimeout(push1, 2000);
        });
    }
    
    function verify (msg, host, cb) {
        var hq = hyperquest('http://localhost:' + port);
        hq.setHeader('host', host);
        hq.pipe(concat(function (err, body) {
            t.equal(msg, String(body));
            if (cb) cb();
        }));
    }
});
test(teardown);
