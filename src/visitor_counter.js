const dateFormat = require('dateformat');

module.exports = (config = {}) => {
	if(!config.collection && !config.hook)
		throw new Error('A collection or a hook is required.');

	// list of known IP addresses
	const ipAddresses = {};

	// call the hook or update the counter in the MongoDB collection
	const incCounter = config.collection
		? counterId => config.collection.updateOne({ id: counterId }, { $inc: { value: 1 } }, { upsert: true })
		: config.hook;

	return (req, res, next) => {
		// determine the today date
		const todayDate = dateFormat(new Date(), 'dd-mm-yyyy');

		// determine the counter prefix
		const counterPrefix = config.prefix || req.hostname;

		// increment the counter of requests
		incCounter(`${counterPrefix}-requests-${todayDate}`);

		// check if the express-session middleware is enabled
		if(req.session === undefined)
			return next();

		// create a list for the current day to store IP addresses
		if(!ipAddresses[todayDate])
			ipAddresses[todayDate] = {};

		// "notFirstVisit" is used because when multiple requests come at the same time from the same web client, they are not identified with the same session id
		// the last visit date is set only after the second wave of requests when the cookie has been initialized client-side
		let withSession = false;
		if(req.session.notFirstVisit && req.session.lastVisitDate !== todayDate) {
			// set the last visit date for this visitor
			req.session.lastVisitDate = todayDate;

			// set the "withSession" boolean to true to avoid incrementing the visitor counter for the same IP with a different cookie
			withSession = true;

			// check if this visitor is not came today with the same IP but a different cookie
			if(!ipAddresses[todayDate][req.ip] || !ipAddresses[todayDate][req.ip].withSession)
				incCounter(`${counterPrefix}-visitors-${todayDate}`);
		}
		req.session.notFirstVisit = true;

		// check if this IP address is new today
		if(!ipAddresses[todayDate][req.ip]) {
			ipAddresses[todayDate][req.ip] = { requests: 1, withSession };
			incCounter(`${counterPrefix}-ip-addresses-${todayDate}`);
		} else {
			ipAddresses[todayDate][req.ip].requests++;
			ipAddresses[todayDate][req.ip].withSession = withSession || ipAddresses[todayDate][req.ip].withSession;
		}
		next();
	};
};
