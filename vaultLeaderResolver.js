'use strict';
var dns = require('dns');
var urlLib = require('url');
var uuid = require('node-uuid');
var request = require('request');
var async = require('async');
var extend = require('extend');
var log = {
    debug: function () {
    },
    info: function () {
    },
    error: function () {
    }
};

module.exports = function (url, options) {

    if (options && options.logEmitter) {
        log = options.logEmitter;
    }


    this.isResolving = false;
    this.url = url;

    var findActiveIp = function (callback) {
        log.debug("will look for active ip only if isResolving is false");
        if (!this.isResolving) {
            this.isResolving = true;
            var startResolvingTime = Date.now();
            var id = uuid.v4();
            log.info("searching for active vault node", id, startResolvingTime, this.url);
            var urlObject = urlLib.parse(this.url);
            var that = this;

            log.debug("trying to resolve", urlObject.hostname);

            var tryAgainOrAbort = function () {
                if (Date.now() - startResolvingTime <= 10 * 1000) {
                    return setTimeout(resolve, 500);
                } else {
                    that.isResolving = false;
                    return callback();
                }
            };

            var findTheLeader = function (addresses) {
                var newIp = null;
                async.each(addresses, function (address, callbackAsync) {
                        var urlWithIpObject = extend({}, urlObject);
                        urlWithIpObject.host = undefined;
                        urlWithIpObject.hostname = address.address;
                        request.get((urlLib.format(urlWithIpObject)) + "/v1/sys/leader", {
                            timeout: 200,
                            gzip: true
                        }, function (error, response, body) {
                            log.info("leader response for ip: ", address, "body: ", body, "error: ", error);
                            let jsonBody = null;
                            try {
                                jsonBody = JSON.parse(body);
                            } catch (e) {
                                log.debug("response wasn't in json format", body)
                            }

                            if (response && response.statusCode === 200 && jsonBody && jsonBody.is_self === true) {
                                log.info("leader found: ", address);
                                newIp = address.address;
                            } else {
                                log.info("not the leader: ", address);
                            }
                            callbackAsync();
                        });
                    },
                    function () {
                        if (newIp) {
                            that.ip = newIp;
                            that.isResolving = false;
                            log.info("active node set", id, new Date(), newIp);
                            return callback();
                        } else {
                            log.info("No active node was found.");
                            tryAgainOrAbort();
                        }
                    }
                );
            };

            var resolve = function () {
                dns.lookup(urlObject.hostname, {all: true, family: 4}, function (err, addresses) {
                        log.debug("Dns lookup response for url: ", that.url);
                        if (!err && addresses && addresses.length && addresses.length > 0) {
                            log.debug("Dns lookup response for url: ", that.url);
                            findTheLeader(addresses);
                        } else {
                            log.info("no address was found", err);
                            tryAgainOrAbort();
                        }
                    }
                );
            };

            resolve();
        } else {
            return callback()
        }

    };

    var replaceDnsWithIp = function (url) {
        if (this.ip) {
            var urlObject = urlLib.parse(url);
            urlObject.host = undefined;
            urlObject.hostname = this.ip;
            url = urlLib.format(urlObject);
        } else { // in case dns resolving failed on startup we still want to find the active. otherwise it will wait until the first failure.
            findActiveIp.call(this, function () {
            });
        }
        return url

    };

    this.replaceDnsWithIp = replaceDnsWithIp.bind(this);
    this.findActiveIp = findActiveIp.bind(this);

    return this;
};