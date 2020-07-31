const express = require('express');
const expressSession = require('express-session');
const expressVisitorCounter = require('express-visitor-counter');

const counters = {};

(async () => {
	const app = express();
	app.enable('trust proxy');
	app.use(expressSession({ secret: 'secret', resave: false, saveUninitialized: true }));
	app.use(expressVisitorCounter({ hook: counterId => counters[counterId] = (counters[counterId] || 0) + 1 }));
	app.get('/', (req, res) => res.json(counters));
	app.listen(8080);
})();
