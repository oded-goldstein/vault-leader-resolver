var sinon = require('sinon');
var request = require('request')
var expect = require('expect');
var dns = require('dns');
var urlLib = require('url');
var async = require('async');

var vaultLeaderResolver;

var getVaultLeaderResolver = function(vaultAddress){
    return new (require('../vaultLeaderResolver'))(vaultAddress);
}

describe("vaultLeaderResolver", function () {
    var urlLibParseStub;
    var urlLibFormatStub;
    var sandbox = sinon.sandbox.create();
    var dnsLookupStub;

    describe("replaceDnsWithIp", function () {
        beforeEach(function () {
            dnsLookupStub = sandbox.spy(dns, "lookup");
            urlLibParseStub = sandbox.spy(urlLib, "parse");
            urlLibFormatStub = sandbox.spy(urlLib, "format");

        });

        afterEach(function () {
            sandbox.restore();
        });


        it("when ip exist - replace the address with the ip", function () {
            var vaultAddress = "http://any.url.com:8080/";
            vaultLeaderResolver = getVaultLeaderResolver(vaultAddress);
            var originalUrl = vaultAddress + "path?param1=sdsd&param2=fkldk#whatever";

            vaultLeaderResolver.ip = "resolvedIp";
            var resolvedUrl = "http://resolvedIp:8080/path?param1=sdsd&param2=fkldk#whatever";
            var url = vaultLeaderResolver.replaceDnsWithIp(originalUrl);
            expect(url).toEqual(resolvedUrl);
        });

        it("when no ip - return original url", function () {
            var vaultAddress = "http://any.url.com:8080/";
            vaultLeaderResolver = getVaultLeaderResolver(vaultAddress);
            var originalUrl = vaultAddress + "path?param1=sdsd&param2=fkldk#whatever";

            vaultLeaderResolver.ip = undefined;
            var url = vaultLeaderResolver.replaceDnsWithIp(originalUrl);
            expect(url).toEqual(originalUrl);
            expect(dnsLookupStub.called).toBe(true);
        });

        it("handles url with ip correctly", function () {
            var vaultAddress = "http://10.0.0.1:8080/";
            vaultLeaderResolver = getVaultLeaderResolver(vaultAddress);
            var originalUrl = vaultAddress + "path?param1=sdsd&param2=fkldk#whatever";

            vaultLeaderResolver.ip = "10.0.0.2";
            var url = vaultLeaderResolver.replaceDnsWithIp(originalUrl);
            expect(url).toEqual("http://10.0.0.2:8080/path?param1=sdsd&param2=fkldk#whatever");
        });

        it("handles url without port correctly", function () {
            var vaultAddress = "http://any.url.com/";
            vaultLeaderResolver = getVaultLeaderResolver(vaultAddress);
            var originalUrl = vaultAddress + "path?param1=sdsd&param2=fkldk#whatever";

            vaultLeaderResolver.ip = "10.0.0.1";
            var url = vaultLeaderResolver.replaceDnsWithIp(originalUrl);
            expect(url).toEqual("http://10.0.0.1/path?param1=sdsd&param2=fkldk#whatever");
        });

        it("handles url without initial slash", function () {
            var vaultAddress = "http://any.url.com";
            vaultLeaderResolver = getVaultLeaderResolver(vaultAddress);
            var originalUrl = vaultAddress + "?param1=sdsd&param2=fkldk#whatever";
            vaultLeaderResolver.ip = "10.0.0.1";
            var url = vaultLeaderResolver.replaceDnsWithIp(originalUrl);
            expect(url).toEqual("http://10.0.0.1/?param1=sdsd&param2=fkldk#whatever");
        });

    });

    describe("findActiveIp", function () {
        var clock;

        beforeEach(function () {
            urlLibParseStub = sandbox.spy(urlLib, "parse");
            dnsLookupStub = sandbox.stub(dns, "lookup");
            vaultLeaderResolver = getVaultLeaderResolver("http://any.url.com:8080/");
            requestGetLeaderStub = sandbox.stub(request, 'get');
        });

        afterEach(function () {
            sandbox.restore();
        });

        it("success - should change the ip successfully", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, [{address: "10.0.0.1"}]);
            requestGetLeaderStub.yields(null, {statusCode: 200}, JSON.stringify({is_self: true}));

            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toBe("10.0.0.1");
                expect(vaultLeaderResolver.isResolving).toBe(false);
                done();
            });
        });

        it("success - multiple addresses return should change the ip successfully to the leader according to vault api", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, [{address: "10.0.0.1"}, {address: "10.0.0.2"}, {address: "10.0.0.3"}, {address: "10.0.0.4"}, {address: "10.0.0.5"}, {address: "10.0.0.6"}]);
            requestGetLeaderStub.yields(null, {statusCode: 200}, JSON.stringify({is_self: false}));

            requestGetLeaderStub.onCall(5).yields(null, {statusCode: 200}, JSON.stringify({is_self: true}));
            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toEqual("10.0.0.6");
                done();
            });
        });


        it("success - only one request to resolve dns takes place at a time. dns calls are synchronous", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, [{address: "10.0.0.1"}]);
            requestGetLeaderStub.callsArgWithAsync(2, null, {statusCode: 200}, JSON.stringify({is_self: true}));

            var id = 0;
            var startArray = [];
            var endArray = [];

            var task = function (done) {
                var myId = id;
                startArray.push(myId);
                id++;
                setTimeout(function () {
                    vaultLeaderResolver.findActiveIp(function () {
                        endArray.push(myId);
                        done();
                    });
                }, 1);

            };

            var tasks = [];
            var numOfCalls = 100;
            for (var i = 0; i < numOfCalls; i++) {
                tasks.push(task);
            }
            async.parallel(tasks
                , function () {
                    expect(dnsLookupStub.callCount).toBeGreaterThanOrEqualTo(1);
                    expect(dnsLookupStub.callCount).toBeLessThanOrEqualTo(2);
                    expect(startArray.length).toBe(numOfCalls);
                    expect(endArray.length).toBe(numOfCalls);
                    done();
                }
            );
        });

        it("failure - should not change the ip if an error occurs", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(new Error("dnsError"), ["10.0.0.1"]);
            clock = sinon.useFakeTimers();

            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
                expect(vaultLeaderResolver.isResolving).toBe(false);
                expect(dnsLookupStub.callCount).toBe(22);
                done();
            });
            clock.tick(10500);
            clock.restore();
        });

        it("failure - should not change the ip if response is not in json format", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, [{address: "10.0.0.1"}]);
            clock = sinon.useFakeTimers();
            requestGetLeaderStub.yields(null, {statusCode: 200}, "<not a json response>");

            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
                expect(vaultLeaderResolver.isResolving).toBe(false);
                expect(dnsLookupStub.callCount).toBe(22);
                expect(requestGetLeaderStub.callCount).toBe(22);

                done();
            });
            clock.tick(10500);
            clock.restore();

        });

        it("failure - should not change the ip if response doesn't have status code 200", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, [{address: "10.0.0.1"}]);
            clock = sinon.useFakeTimers();
            requestGetLeaderStub.yields(null, {statusCode: 500}, "anything");

            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
                expect(vaultLeaderResolver.isResolving).toBe(false);
                expect(dnsLookupStub.callCount).toBe(22);
                expect(requestGetLeaderStub.callCount).toBe(22);
                done();
            });
            clock.tick(10500);
            clock.restore();
        });


        it("failure - should not change the ip if returns with 0 addresses exist", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, []);
            clock = sinon.useFakeTimers();

            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
                expect(vaultLeaderResolver.isResolving).toBe(false);
                expect(dnsLookupStub.callCount).toBe(22);
                done();
            });
            clock.tick(10500);
            clock.restore();
        });


        it("failure - should not change the ip if no address exist", function (done) {
            expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
            dnsLookupStub.yields(null, null);
            clock = sinon.useFakeTimers();

            vaultLeaderResolver.findActiveIp(function () {
                expect(vaultLeaderResolver.ip).toNotExist("ip should be undefined on initialization");
                expect(vaultLeaderResolver.isResolving).toBe(false);
                expect(dnsLookupStub.callCount).toBe(22);
                done();
            });

            clock.tick(10500);
            clock.restore();
        });

    })

})
;
