const dateFormat = require('dateformat');

const twoDays = 48 * 3600;

module.exports = (config = {}) => {
	if(!config.collection && !config.hook)
		throw new Error('A collection or a hook is required.');

	// list of known IP addresses and session ids
	const ipAddresses = {};
	const sessionIds = {};

	// call the hook or update the counter in the MongoDB collection
	const inc = config.collection
		? counterId => config.collection.updateOne({ id: counterId }, { $inc: { value: 1 } }, { upsert: true })
		: config.hook;

	// wrap the counter incrementation with redis synchronisation
	let incCounter;
	if(config.redisClient) {
		// support for node-redis v3 and v4
		const redisSet = config.redisClient.flushdb ?
			key => new Promise((resolve, reject) => config.redisClient.set(key, 'OK', 'NX', 'EX', twoDays, (err, res) => err ? reject(err) : resolve(res))) : // v3
			key => config.redisClient.set(key, 'OK', { NX: true, EX: twoDays }); // v4

		// the action is executed only if the key does not exist in the redis database
		const syncWithRedis = (key, redisKey, action) => redisKey ? redisSet(redisKey).then(res => res && action(key), err => { throw err }) : action(key);
		incCounter = (key, redisKey) => syncWithRedis(key, redisKey, inc);
	} else incCounter = inc;

	return (req, res, next) => {
		// determine the today date
		const todayDate = dateFormat(new Date(), 'dd-mm-yyyy');

		// methods to build a counter id
		const getPrefixedCounter = buildCounterId.bind(null, !config.withoutDate && todayDate, config.prefix || req.hostname);
		const getCounter = buildCounterId.bind(null, !config.withoutDate && todayDate);

		// increment the counter of requests
		incCounter(getPrefixedCounter('requests'));

		// check if the express-session middleware is enabled
		if(req.session === undefined)
			return next();

		// determine the ip address key and the session key
		const ipAddressKey = `${todayDate}-${req.ip}`;
		const sessionKey = `${todayDate}-${req.session.id}`;

		// "notFirstRequest" is used because when multiple requests come at the same time from the same web client, they are not identified with the same session id
		// the last visit date is set only after the second wave of requests when the cookie has been initialized client-side
		let processedToday = false;
		if(req.session.notFirstRequest && req.session.lastVisitDate !== todayDate) {
			// check if this visitor is not came today
			// the IP address and the session are checked to see if they have not already been processed
			if(
				(!ipAddresses[ipAddressKey] || !ipAddresses[ipAddressKey].processedToday) &&
				(!sessionIds[sessionKey] || !sessionIds[sessionKey].processedToday)
			) {
				incCounter(getPrefixedCounter('visitors'), getCounter(req.ip, 'visitor'));
				!req.session.lastVisitDate && incCounter(getPrefixedCounter('new-visitors'), getCounter(req.ip, 'new-visitor'));
			}

			// set the last visit date for this visitor
			req.session.lastVisitDate = todayDate;

			// set the "processedToday" boolean to true to avoid incrementing the visitor counter for the same IP or the same session
			processedToday = true;
		}
		req.session.notFirstRequest = true;

		// check if this IP address is new today
		if(!ipAddresses[ipAddressKey]) {
			ipAddresses[ipAddressKey] = { requests: 1, processedToday };
			incCounter(getPrefixedCounter('ip-addresses'), getCounter(req.ip, 'ip-address'));
		} else {
			ipAddresses[ipAddressKey].requests++;
			ipAddresses[ipAddressKey].processedToday = processedToday || ipAddresses[ipAddressKey].processedToday;
		}

		// check if this session is new today
		if(!sessionIds[sessionKey]) {
			sessionIds[sessionKey] = { requests: 1, processedToday };
			incCounter(getPrefixedCounter('sessions'), getCounter(req.session.id, 'session'));
		} else {
			sessionIds[sessionKey].requests++;
			sessionIds[sessionKey].processedToday = processedToday || sessionIds[sessionKey].processedToday;
		}
		next();
	};
};

function buildCounterId(todayDate, prefix, counterName) {
	return todayDate ? `${prefix}-${counterName}-${todayDate}` : `${prefix}-${counterName}`
}
