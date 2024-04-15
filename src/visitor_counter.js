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
			// check if this visitor has not come yet today
			// the IP address and the session are checked to see if they have not already been processed
			if(
				(!ipAddresses[ipAddressKey] || !ipAddresses[ipAddressKey].processedToday) &&
				(!sessionIds[sessionKey] || !sessionIds[sessionKey].processedToday)
			) {
				incCounter(getPrefixedCounter('visitors'), getCounter(req.ip, 'visitor'));
				!req.session.lastVisitDate && incCounter(getPrefixedCounter('new-visitors'), getCounter(req.ip, 'new-visitor'));
				if(req.headers['user-agent'] && isMobileDevice(req.headers['user-agent'])) { // counters for mobile devices
					incCounter(getPrefixedCounter('visitors-from-mobile'), getCounter(req.ip, 'mobile-visitor'));
					!req.session.lastVisitDate && incCounter(getPrefixedCounter('new-visitors-from-mobile'), getCounter(req.ip, 'mobile-new-visitor'));
				}
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

// http://detectmobilebrowsers.com/
function isMobileDevice(userAgent) {
	return (
		/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(userAgent) ||
		/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(userAgent.substr(0,4))
	);
}
