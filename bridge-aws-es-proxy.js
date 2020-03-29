'use strict';

var conf = require('e2e-conf');
conf.init(__dirname);


var AWS = require('aws-sdk');
var http = require('http');
var httpProxy = require('http-proxy');
var express = require('express');
var bodyParser = require('body-parser');
var stream = require('stream');
var figlet = require('figlet');
var compress = require('compression');


var REGION = conf.get('region') || "eu-central-1";
var BIND_ADDRESS = conf.get('bindAddress') || "127.0.0.1";
var PORT = conf.get('port') || 9200;
var REQ_LIMIT = conf.get('limit') || "10000kb";

var credentials = new AWS.SharedIniFileCredentials({filename: conf.get('credentialsFile')});
AWS.config.credentials = credentials;

function getCredentials(req, res, next) {
    return credentials.get(function (err) {
        if (err) return next(err);
        else return next();
    });
}

var ENDPOINT = conf.get('endpoint');
var TARGET = ENDPOINT;
if (!TARGET.match(/^https?:\/\//)) {
    TARGET = 'https://' + TARGET;
}
var options = {
    target: TARGET,
    changeOrigin: true,
    secure: true
};

var proxy = httpProxy.createProxyServer(options);

var app = express();
app.use(compress());
app.use(bodyParser.raw({limit: REQ_LIMIT, type: function() { return true; }}));
app.use(getCredentials);


app.use(async function (req, res) {
    var bufferStream;
    if (Buffer.isBuffer(req.body)) {
        var bufferStream = new stream.PassThrough();
        await bufferStream.end(req.body);
    }
    proxy.web(req, res, {buffer: bufferStream});
});

proxy.on('proxyReq', function (proxyReq, req) {
    var endpoint = new AWS.Endpoint(ENDPOINT);
    var request = new AWS.HttpRequest(endpoint);
    request.method = proxyReq.method;
    request.path = proxyReq.path;
    request.region = REGION;
    if (Buffer.isBuffer(req.body)) request.body = req.body;
    if (!request.headers) request.headers = {};
    request.headers['presigned-expires'] = false;
    request.headers['Host'] = endpoint.hostname;

    var signer = new AWS.Signers.V4(request, 'es');
    signer.addAuthorization(credentials, new Date());

    proxyReq.setHeader('Host', request.headers['Host']);
    proxyReq.setHeader('X-Amz-Date', request.headers['X-Amz-Date']);
    proxyReq.setHeader('Authorization', request.headers['Authorization']);
    if (request.headers['x-amz-security-token']) proxyReq.setHeader('x-amz-security-token', request.headers['x-amz-security-token']);
});

proxy.on('proxyRes', function (proxyReq, req, res) {
    if (req.url.match(/\.(css|js|img|font)/)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
});

http.createServer(app).listen(PORT, BIND_ADDRESS);

console.log(figlet.textSync('PAS Bridge AWS ES Proxy!', {
    font: 'Speed',
    horizontalLayout: 'default',
    verticalLayout: 'default'
}));


console.log('AWS ES cluster available at http://' + BIND_ADDRESS + ':' + PORT);
console.log('Kibana available at http://' + BIND_ADDRESS + ':' + PORT + '/_plugin/kibana/');

