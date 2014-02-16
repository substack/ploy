var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var verify = require('./lib/verify');
var push = require('./lib/push');

function setup (t) {
    var ps = spawn(__dirname + '/setup.sh', [ 'deploy' ], {
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

function commit (cb) {
    var ps = spawn(__dirname + '/commit/deploy.sh', [], {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', cb);
}

var tmpDir = '/tmp/ploy-test/' + Math.random();
var server = ploy(tmpDir);
var port;

test(setup);
test({ timeout: 90 * 1000 }, function (t) {
    t.plan(5);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    function push0 () {
        server.once('start', function () {
            setTimeout(function () {
                verify(port, t, 'beep boop\n', 'local', deploy);
            }, 2000);
        });
        push(port, 'master', function (code) {
            t.equal(code, 0);
        });
    }
    
    function push1 () {
        server.once('start', function () {
            setTimeout(function () {
                verify(port, t, 'rawr\n', 'staging.local');
            }, 2000);
        });
        push(port, 'staging', function (code) {
            t.equal(code, 0);
        });
    }
    
    function deploy () {
        commit(function (code) {
            t.equal(code, 0);
            push1();
        });
    }
});
test(teardown);
