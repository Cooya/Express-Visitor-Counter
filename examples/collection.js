const express = require('express');
const expressSession = require('express-session');
const expressVisitorCounter = require('express-visitor-counter');
const MongoClient = require('mongodb').MongoClient;

(async () => {
	const dbConnection = await MongoClient.connect('mongodb://localhost/test', { useUnifiedTopology: true });
	const counters = dbConnection.db().collection('counters');

	const app = express();
	app.enable('trust proxy');
	app.use(expressSession({ secret: 'secret', resave: false, saveUninitialized: true }));
	app.use(expressVisitorCounter({ collection: counters }));
	app.get('/', async (req, res) => res.json(await counters.find().toArray()));
	app.listen(8080);
})();
