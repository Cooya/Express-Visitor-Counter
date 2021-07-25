const { assert } = require('chai');
const dateFormat = require('dateformat');
const express = require('express');
const expressSession = require('express-session');
const MockDate = require('mockdate');
const MongoClient = require('mongodb').MongoClient;
const redis = require('redis');
const request = require('supertest');

const visitorCounter = require('../src/visitor_counter');

function createAgent(counterMiddleware) {
	const app = express();
	app.enable('trust proxy');
	app.use(expressSession({ secret: 'secret', resave: false, saveUninitialized: true }));
	app.use(counterMiddleware);
	app.get('/', (req, res, next) => res.end());
	return request.agent(app);
}

function sendRequest(agent, ipAddress = '50.50.50.0') {
	return new Promise(resolve => {
		agent.get('/').set('X-Forwarded-For', ipAddress).end(resolve);
	});
}

function sleep(seconds) {
	return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

describe('express-visitor-counter', () => {
	let todayDate = dateFormat(new Date(), 'dd-mm-yyyy');
	let dbConnection, counters, redisClient;

	before(async () => {
		dbConnection = await MongoClient.connect('mongodb://localhost/test', { useUnifiedTopology: true });
		counters = dbConnection.db().collection('counters');
		redisClient = redis.createClient({ db: 1 });
	});

	beforeEach(async () => {
		await counters.deleteMany();
		redisClient.flushdb();
	});

	after(async () => {
		await dbConnection.close();
		redisClient.quit();
	});

	it('check visitor counter with MongoDB collection', async () => {
		// daily requests counter
		let requestsCounter = await counters.findOne({ id: `127.0.0.1-requests-${todayDate}` })
		assert.isNull(requestsCounter);

		// daily new visitors counter
		let newVisitorsCounter = await counters.findOne({ id: `127.0.0.1-new-visitors-${todayDate}` });
		assert.isNull(newVisitorsCounter);

		// daily visitors counter
		let visitorsCounter = await counters.findOne({ id: `127.0.0.1-visitors-${todayDate}` });
		assert.isNull(visitorsCounter);

		// daily ip addresses counter
		let ipAddressesCounter = await counters.findOne({ id: `127.0.0.1-ip-addresses-${todayDate}` });
		assert.isNull(ipAddressesCounter);

		// create an HTTP agent
		const counterMiddleware = visitorCounter({ collection: counters });
		let agent = createAgent(counterMiddleware);
		let agent2 = createAgent(counterMiddleware);

		// first wave of requests with 3 different IP addresses
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent, '50.50.50.1'),
			sendRequest(agent, '50.50.50.2')
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2, '50.50.50.1'),
			sendRequest(agent2, '50.50.50.2')
		]);

		// check the counters
		requestsCounter = await counters.findOne({ id: `127.0.0.1-requests-${todayDate}` });
		assert.equal(requestsCounter.value, 6);
		newVisitorsCounter = await counters.findOne({ id: `127.0.0.1-new-visitors-${todayDate}` });
		assert.isNull(newVisitorsCounter);
		visitorsCounter = await counters.findOne({ id: `127.0.0.1-visitors-${todayDate}` });
		assert.isNull(visitorsCounter);
		ipAddressesCounter = await counters.findOne({ id: `127.0.0.1-ip-addresses-${todayDate}` });
		assert.equal(ipAddressesCounter.value, 3);

		// second wave of requests with the same IP address
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent),
			sendRequest(agent)
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2),
			sendRequest(agent2)
		]);

		// check the counters
		requestsCounter = await counters.findOne({ id: `127.0.0.1-requests-${todayDate}` });
		assert.equal(requestsCounter.value, 12);
		newVisitorsCounter = await counters.findOne({ id: `127.0.0.1-new-visitors-${todayDate}` });
		assert.equal(newVisitorsCounter.value, 1);
		visitorsCounter = await counters.findOne({ id: `127.0.0.1-visitors-${todayDate}` });
		assert.equal(visitorsCounter.value, 1);
		ipAddressesCounter = await counters.findOne({ id: `127.0.0.1-ip-addresses-${todayDate}` });
		assert.equal(ipAddressesCounter.value, 3);

		// third wave of requests with the same IP address
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent),
			sendRequest(agent)
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2),
			sendRequest(agent2)
		]);

		// check the counters
		requestsCounter = await counters.findOne({ id: `127.0.0.1-requests-${todayDate}` });
		assert.equal(requestsCounter.value, 18);
		newVisitorsCounter = await counters.findOne({ id: `127.0.0.1-new-visitors-${todayDate}` });
		assert.equal(newVisitorsCounter.value, 1);
		visitorsCounter = await counters.findOne({ id: `127.0.0.1-visitors-${todayDate}` });
		assert.equal(visitorsCounter.value, 1);
		ipAddressesCounter = await counters.findOne({ id: `127.0.0.1-ip-addresses-${todayDate}` });
		assert.equal(ipAddressesCounter.value, 3);

		// create a new agent (with a different cookie)
		agent = createAgent(counterMiddleware);
		agent2 = createAgent(counterMiddleware);

		// fourth wave of requests
		await sendRequest(agent); // init the session
		await sendRequest(agent); // increment the counter
		await sendRequest(agent, '50.50.50.3'); // same cookie but different IP address
		await sendRequest(agent2); // init the session
		await sendRequest(agent2); // increment the counter
		await sendRequest(agent2, '50.50.50.3'); // same cookie but different IP address

		// check the counters
		requestsCounter = await counters.findOne({ id: `127.0.0.1-requests-${todayDate}` });
		assert.equal(requestsCounter.value, 24);
		newVisitorsCounter = await counters.findOne({ id: `127.0.0.1-new-visitors-${todayDate}` });
		assert.equal(newVisitorsCounter.value, 1);
		visitorsCounter = await counters.findOne({ id: `127.0.0.1-visitors-${todayDate}` });
		assert.equal(visitorsCounter.value, 1);
		ipAddressesCounter = await counters.findOne({ id: `127.0.0.1-ip-addresses-${todayDate}` });
		assert.equal(ipAddressesCounter.value, 4);

		// change the date
		const today = new Date();
		MockDate.set(today.setDate(today.getDate() + 1));
		todayDate = dateFormat(new Date(), 'dd-mm-yyyy');

		// fifth wave of requests with a different date
		await sendRequest(agent);
		await sendRequest(agent);
		await sendRequest(agent2);
		await sendRequest(agent2);

		// check the counters
		requestsCounter = await counters.findOne({ id: `127.0.0.1-requests-${todayDate}` });
		assert.equal(requestsCounter.value, 4);
		newVisitorsCounter = await counters.findOne({ id: `127.0.0.1-new-visitors-${todayDate}` });
		assert.isNull(newVisitorsCounter);
		visitorsCounter = await counters.findOne({ id: `127.0.0.1-visitors-${todayDate}` });
		assert.equal(visitorsCounter.value, 1);
		ipAddressesCounter = await counters.findOne({ id: `127.0.0.1-ip-addresses-${todayDate}` });
		assert.equal(ipAddressesCounter.value, 1);

		// set back the date
		MockDate.reset();
	});

	it('check visitor counter with hook', async () => {
		let requestsCounter = 0, newVisitorsCounter = 0, visitorsCounter = 0, ipAddressesCounter = 0;

		// init the visitor counter middleware with the hook function
		counterMiddleware = visitorCounter({ hook: counterId => {
			if(counterId.includes('requests'))
				requestsCounter++;
			else if(counterId.includes('new-visitors'))
				newVisitorsCounter++;
			else if(counterId.includes('visitors'))
				visitorsCounter++;
			else if(counterId.includes('ip-addresses'))
				ipAddressesCounter++;
		} });
	
		// create an HTTP agent
		let agent = createAgent(counterMiddleware);
	
		// first wave of requests with 3 different IP addresses
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent, '50.50.50.1'),
			sendRequest(agent, '50.50.50.2')
		]);
		assert.equal(requestsCounter, 3);
		assert.equal(newVisitorsCounter, 0);
		assert.equal(visitorsCounter, 0);
		assert.equal(ipAddressesCounter, 3);
	
		// second wave of requests with the same IP address
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent),
			sendRequest(agent)
		]);
		assert.equal(requestsCounter, 6);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 3);
	
		// third wave of requests with the same IP address
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent),
			sendRequest(agent)
		]);
		assert.equal(requestsCounter, 9);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 3);
	
		// create a new agent (with a different cookie)
		agent = createAgent(counterMiddleware);
		await sendRequest(agent); // init the session
		await sendRequest(agent); // increment the counter
		await sendRequest(agent, '50.50.50.3'); // same cookie but different IP address
		assert.equal(requestsCounter, 12);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 4);

		// change the date
		const today = new Date();
		MockDate.set(today.setDate(today.getDate() + 1));
		todayDate = dateFormat(new Date(), 'dd-mm-yyyy');

		// send two more requests with a different date
		await sendRequest(agent);
		await sendRequest(agent);
		assert.equal(requestsCounter, 12 + 2);
		assert.equal(newVisitorsCounter, 1 + 0);
		assert.equal(visitorsCounter, 1 + 1);
		assert.equal(ipAddressesCounter, 4 + 1);

		// set back the date
		MockDate.reset();
	});

	it('check visitor counter with hook and ip addresses stored in redis', async () => {
		let requestsCounter = 0, newVisitorsCounter = 0, visitorsCounter = 0, ipAddressesCounter = 0;

		const hook = counterId => {
			if(counterId.includes('requests'))
				requestsCounter++;
			else if(counterId.includes('new-visitors'))
				newVisitorsCounter++;
			else if(counterId.includes('visitors'))
				visitorsCounter++;
			else if(counterId.includes('ip-addresses'))
				ipAddressesCounter++;
		}

		// create two HTTP agents
		let agent = createAgent(visitorCounter({ hook, redisClient }));
		let agent2 = createAgent(visitorCounter({ hook, redisClient }));

		// first wave of requests with 3 different IP addresses
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent, '50.50.50.1'),
			sendRequest(agent, '50.50.50.2')
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2, '50.50.50.1'),
			sendRequest(agent2, '50.50.50.2')
		]);

		// check the counters
		assert.equal(requestsCounter, 6);
		assert.equal(newVisitorsCounter, 0);
		assert.equal(visitorsCounter, 0);
		assert.equal(ipAddressesCounter, 3);

		// second wave of requests with 3 different IP addresses
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent, '50.50.50.1'),
			sendRequest(agent, '50.50.50.2')
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2, '50.50.50.1'),
			sendRequest(agent2, '50.50.50.2')
		]);

		// check the counters
		assert.equal(requestsCounter, 12);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 3);

		// third wave of requests with the same IP address
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent),
			sendRequest(agent)
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2),
			sendRequest(agent2)
		]);

		// check the counters
		assert.equal(requestsCounter, 18);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 3);

		// fourth wave of requests with the same IP address
		await Promise.all([
			sendRequest(agent),
			sendRequest(agent),
			sendRequest(agent)
		]);
		await Promise.all([
			sendRequest(agent2),
			sendRequest(agent2),
			sendRequest(agent2)
		]);

		// check the counters
		assert.equal(requestsCounter, 24);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 3);

		// reset the agents to get a new session cookie
		agent = createAgent(visitorCounter({ hook, redisClient }));
		agent2 = createAgent(visitorCounter({ hook, redisClient }));

		// fifth wave of requests with the same IP address
		await sendRequest(agent); // init the session
		await sendRequest(agent); // increment the counter
		await sendRequest(agent, '50.50.50.3'); // same cookie but different IP address
		await sendRequest(agent2); // init the session
		await sendRequest(agent2); // increment the counter
		await sendRequest(agent2, '50.50.50.3'); // same cookie but different IP address

		// check the counters
		assert.equal(requestsCounter, 30);
		assert.equal(newVisitorsCounter, 1);
		assert.equal(visitorsCounter, 1);
		assert.equal(ipAddressesCounter, 4);

		// change the date
		const today = new Date();
		MockDate.set(today.setDate(today.getDate() + 1));
		todayDate = dateFormat(new Date(), 'dd-mm-yyyy');

		// sixth wave of requests with a different date
		await sendRequest(agent);
		await sendRequest(agent);
		await sendRequest(agent2);
		await sendRequest(agent2);

		// check the counters
		assert.equal(requestsCounter, 30 + 4);
		assert.equal(newVisitorsCounter, 1 + 0);
		assert.equal(visitorsCounter, 1 + 1);
		assert.equal(ipAddressesCounter, 4 + 1);

		// set back the date
		MockDate.reset();
	});
})
