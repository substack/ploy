var spawn = require('child_process').spawn;
var fs = require('fs');
var dir = __dirname + '/../repo';

module.exports = function check (port, branch, cb) {
    fs.exists(dir, function (ex) {
        if (ex) setTimeout(push, 1000, port, branch, cb)
        else setTimeout(check, 1000)
    });
};
    
function push (port, branch, cb) {
    var args = [
        'push',
        'http://localhost:' + port + '/_ploy/repo.git',
        branch
    ];
    var ps = spawn('git', args, { cwd: dir });
    ps.stdout.pipe(process.stdout, { end: false });
    ps.stderr.pipe(process.stderr, { end: false });
    ps.on('exit', cb);
}
