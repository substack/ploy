var test = require('tap').test;
var ploy = require('../');
var path = require('path');
var spawn = require('child_process').spawn;
var verify = require('./lib/verify');
var push = require('./lib/push');

function setup (t) {
    var ps = spawn(__dirname + '/setup.sh', [ 'test' ], {
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
    var ps = spawn(__dirname + '/commit/test.sh', [], {
        cwd: __dirname + '/repo'
    });
    ps.on('exit', cb);
}

var os = require('os');
var mkdirp = require('mkdirp');
var tmpDir = path.join(os.tmpdir(), 'ploy-test', ''+Math.random());
mkdirp.sync(tmpDir);

var server = ploy({
  repodir: path.resolve(tmpDir + '/repo'),
  workdir: path.resolve(tmpDir + '/work'),
  logdir: path.resolve(tmpDir + '/log'),
  skipTest: true,
});
var port;

test(setup);
test('scripts.test', { timeout: 90 * 1000 }, function (t) {
    t.plan(5);
    server.listen(function () {
        port = server.address().port;
        setTimeout(push0, 2000);
    });
    
    function push0 () {
        server.once('start', function () {
            setTimeout(function () {
                verify(port, t, "undefined", 'local', deploy);
            }, 3000);
        });
        push(port, 'master', function (code) {
            t.equal(code, 0);
        });
    }
    
    function push1 () {
        server.once('start', function () {
            setTimeout(function () {
                verify(port, t, "undefined", 'staging.local');
            }, 3000);
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
