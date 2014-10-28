var _ = require('underscore');
var mongo = require('mongojs');
var async = require('async');
var tools = require('../util/tools.js');

var storage = function(exchangeSettings, mongoConnectionString, logger) {

	this.pair = exchangeSettings.currencyPair.pair;
	this.exchange = exchangeSettings.exchange;
	this.dbCollectionName = exchangeSettings.exchange + exchangeSettings.currencyPair.pair;
	this.mongoConnectionString = mongoConnectionString;
	this.logger = logger;

	_.bindAll(this, 'push', 'getLastNCandles', 'getAllCandles', 'getAllCandlesSince', 'getLastClose', 'getLastNonEmptyPeriod', 'getLastNonEmptyClose', 'getLastNCompleteAggregatedCandleSticks', 'getLastCompleteAggregatedCandleStick', 'getCompleteAggregatedCandleSticks', 'getLastNAggregatedCandleSticks', 'getAggregatedCandleSticks', 'calculateAggregatedCandleStick', 'aggregateCandleSticks', 'removeOldDBCandles', 'getInitialBalance', 'setInitialBalance');

};

storage.prototype.push = function(cs, callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.update({period: cs.period}, cs, { upsert: true }, function(err, result) {

		csDatastore.close();

		if(err) {

			callback(err);

		} else {

			callback(null);

		}

	});

};

storage.prototype.getLastNCandles = function(N, callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.find({}).sort({period:-1}).limit(N, function(err, candlesSticks) {

		csDatastore.close();

		if(err) {

			callback(err, []);

		} else {

			callback(null, candlesSticks.reverse());

		}

	});


};

storage.prototype.getAllCandles = function(callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.find({}).sort({period:1}, function(err, candlesSticks) {

		csDatastore.close();

		if(err) {

			callback(err, []);

		} else {

			callback(null, candlesSticks);

		}

	});


};

storage.prototype.getAllCandlesSince = function(period, callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.find({period: { $gte: period }}).sort({period:1}, function(err, candlesSticks) {

		csDatastore.close();

		if(err) {

			callback(err, []);

		} else {

			callback(null, candlesSticks);

		}

	});


};

storage.prototype.getLastClose = function(callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.find({}).sort({period:-1}).limit(1, function(err, candleSticks) {

		csDatastore.close();

		if(err) {

			callback(err, 0);

		} else {

			if(candleSticks.length > 0) {
				callback(null, candleSticks[0].close);
			} else {
				callback(null, 0);
			}

		}

	});

};

storage.prototype.getLastNonEmptyPeriod = function(callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.find({volume: { $gt: 0 }}).sort({period:-1}).limit(1, function(err, candleSticks) {

		csDatastore.close();

		if(err) {

			callback(err, 0);

		} else {

			if(candleSticks.length > 0) {
				callback(null, candleSticks[0].period);
			} else {
				callback(null, 0);
			}

		}

	});

};

storage.prototype.getLastNonEmptyClose = function(callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	csCollection.find({volume: { $gt: 0 }}).sort({period:-1}).limit(1, function(err, candleSticks) {

		csDatastore.close();

		if(err) {

			callback(err, 0);

		} else {

			if(candleSticks.length > 0) {
				callback(null, candleSticks[0].close);
			} else {
				callback(null, 0);
			}

		}

	});

};

storage.prototype.getLastNCompleteAggregatedCandleSticks = function(N, candleStickSize, callback) {

	this.getLastNAggregatedCandleSticks(N + 1, candleStickSize, function(err, aggregatedCandleSticks) {
		aggregatedCandleSticks.pop();
		callback(null, aggregatedCandleSticks);
	});

};

storage.prototype.getLastCompleteAggregatedCandleStick = function(candleStickSize, callback) {

	this.getLastNAggregatedCandleSticks(2, candleStickSize, function(err, aggregatedCandleSticks) {
		aggregatedCandleSticks.pop();
		callback(null, _.last(aggregatedCandleSticks));
	});

};

storage.prototype.getCompleteAggregatedCandleSticks = function(candleStickSize, callback) {

	this.getAggregatedCandleSticks(candleStickSize, function(err, aggregatedCandleSticks) {
		aggregatedCandleSticks.pop();
		callback(null, aggregatedCandleSticks);
	});

};

storage.prototype.getLastNAggregatedCandleSticks = function(N, candleStickSize, callback) {

	var candleStickSizeSeconds = candleStickSize * 60;

	var now = tools.unixTimeStamp(new Date().getTime());
	var closestCandleStick = (Math.floor(now/candleStickSizeSeconds)*candleStickSizeSeconds);

	var startRange = closestCandleStick - (candleStickSizeSeconds * N);

	this.getAllCandlesSince(startRange, function(err, candleSticks) {

		if(candleSticks.length > 0) {

			var aggregatedCandleSticks = this.aggregateCandleSticks(candleStickSize, candleSticks);

			callback(null, aggregatedCandleSticks);

		} else {

			callback(null, []);

		}

	}.bind(this));

};

storage.prototype.getAggregatedCandleSticks = function(candleStickSize, callback) {

	this.getAllCandlesSince(0, function(err, candleSticks) {

		if(candleSticks.length > 0) {

			var aggregatedCandleSticks = this.aggregateCandleSticks(candleStickSize, candleSticks);

			callback(null, aggregatedCandleSticks);

		} else {

			callback(null, []);

		}

	}.bind(this));

};

storage.prototype.calculateAggregatedCandleStick = function(period, relevantSticks) {

	var currentCandleStick = {'period':period,'open':undefined,'high':undefined,'low':undefined,'close':undefined,'volume':0, 'vwap':undefined};

	currentCandleStick.open = relevantSticks[0].open;
	currentCandleStick.high = _.max(relevantSticks, function(relevantStick) { return relevantStick.high; }).high;
	currentCandleStick.low = _.min(relevantSticks, function(relevantStick) { return relevantStick.low; }).low;
	currentCandleStick.close = relevantSticks[relevantSticks.length - 1].close;
	currentCandleStick.volume = tools.round(_.reduce(relevantSticks, function(memo, entry) { return memo + entry.volume; }, 0), 8);
	if(currentCandleStick.volume === 0) {
		currentCandleStick.vwap = currentCandleStick.close;
	} else {
		currentCandleStick.vwap = tools.round(_.reduce(relevantSticks, function(memo, entry) { return memo + (entry.vwap * entry.volume); }, 0) / currentCandleStick.volume, 2);
	}

	return currentCandleStick;

};

storage.prototype.aggregateCandleSticks = function(candleStickSize, candleSticks) {

	var candleStickSizeSeconds = 60 * candleStickSize;

	var aggregatedCandleSticks = [];

	var startTimeStamp = Math.floor(candleSticks[0].period / candleStickSizeSeconds) * candleStickSizeSeconds;
	var stopTimeStamp = _.last(candleSticks).period;

	var filterOnPeriod = function(candleStick) { return candleStick.period >= beginPeriod && candleStick.period < endPeriod; };
	var filterOnVolume = function(candleStick) { return candleStick.volume > 0; };

	for(var i = startTimeStamp;i <= stopTimeStamp;i = i + candleStickSizeSeconds) {

		var beginPeriod = i;
		var endPeriod = beginPeriod + candleStickSizeSeconds;

		var relevantSticks = _.filter(candleSticks, filterOnPeriod);

		var vrelevantSticks = _.filter(relevantSticks, filterOnVolume);

		if(vrelevantSticks.length > 0) {
			relevantSticks = vrelevantSticks;
		}

		var currentCandleStick = this.calculateAggregatedCandleStick(beginPeriod, relevantSticks);

		aggregatedCandleSticks.push(currentCandleStick);

	}

	return aggregatedCandleSticks;

};

storage.prototype.removeOldDBCandles = function(candleStickSize, callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection(this.dbCollectionName);

	var candleStickSizeSeconds = candleStickSize * 60;

	var now = Math.floor(tools.unixTimeStamp(new Date().getTime()) / candleStickSizeSeconds) * candleStickSizeSeconds;
	var oldPeriod = now - (candleStickSizeSeconds * 10000);

	csCollection.remove({ period: { $lt: oldPeriod } }, function(err, resp) {

		csDatastore.close();

		callback(null);

	});

};

storage.prototype.getInitialBalance = function(callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection('balance');

	csCollection.find({exchangePair: this.dbCollectionName}).limit(1, function(err, balance) {

		csDatastore.close();

		if(err) {

			callback(err);

		} else if(balance.length > 0 ){

			var initialBalance = balance[0].initialBalance;

			callback(null, initialBalance);

		} else {

			callback(null, null);

		}

	}.bind(this));

};

storage.prototype.setInitialBalance = function(initialBalance, callback) {

	var csDatastore = mongo(this.mongoConnectionString);
	var csCollection = csDatastore.collection('balance');

	csCollection.update({exchangePair: this.dbCollectionName}, {exchangePair: this.dbCollectionName, initialBalance: initialBalance}, { upsert: true }, function(err, doc) {

		csDatastore.close();

		if(err) {

			callback(err);

		} else {

			callback(null);

		}

	}.bind(this));

};

module.exports = storage;