module.exports = function (req, res, bounce) {
    if (!req.connection.encrypted) {
        for (var i = 0; i < this.bouncers.length; i++) {
            if (!this.bouncers[i].key) continue;
            var hostname = req.headers.host.split(':')[0];
            var host = hostname + ':' + this.bouncers[i].address().port;
            
            res.statusCode = 302;
            res.setHeader('location', 'https://' + host + req.url);
            return res.end();
        }
        
        res.statusCode = 404;
        res.end('no https endpoint configured\n');
    }
    else bounce()
};
