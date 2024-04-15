# Express-Visitor-Counter

[![npm version](https://badge.fury.io/js/express-visitor-counter.svg)](https://www.npmjs.com/package/express-visitor-counter)

Express middleware to count visitors using IP address and cookies.
The middleware will increment 7 counters :

- `requests-dd-mm-yyyy` : number of daily HTTP requests received by the server
- `new-visitors-dd-mm-yyyy` : number of daily new visitors on your website
- `visitors-dd-mm-yyyy` : number of daily unique visitors on your website
- `new-visitors-from-mobile-dd-mm-yyyy` : number of daily new visitors from a mobile device on your website
- `visitors-from-mobile-dd-mm-yyyy` : number of daily unique visitors from a mobile device on your website
- `ip-addresses-dd-mm-yyyy` : number of daily unique ip addresses which hit your server
- `sessions-dd-mm-yyyy` : number of daily unique sessions which hit your server

## Installation

```bash
npm i express-visitor-counter
```

## Usage

The middleware needs the Express option `trust proxy` to be set to true and the `express-session` middleware.  
The middleware can be used with multiple instances of server if counters are stored in Redis database.

With a MongoDB collection :

```js
const express = require('express');
const expressSession = require('express-session');
const expressVisitorCounter = require('express-visitor-counter');
const { MongoClient } = require('mongodb');

(async () => {
  const dbConnection = await MongoClient.connect('mongodb://localhost/test', { useUnifiedTopology: true });
  const counters = dbConnection.db().collection('counters');

  const app = express();
  app.enable('trust proxy');
  app.use(expressSession({ secret: 'secret', resave: false, saveUninitialized: true }));
  app.use(expressVisitorCounter({ collection: counters }));
  app.get('/', async (req, res, next) => res.json(await counters.find().toArray()));
  app.listen(8080);
})();
```

With a hook function :

```js
const express = require('express');
const expressSession = require('express-session');
const expressVisitorCounter = require('express-visitor-counter');

const counters = {};

(async () => {
  const app = express();
  app.enable('trust proxy');
  app.use(expressSession({ secret: 'secret', resave: false, saveUninitialized: true }));
  app.use(expressVisitorCounter({ hook: counterId => counters[counterId] = (counters[counterId] || 0) + 1 }));
  app.get('/', (req, res, next) => res.json(counters));
  app.listen(8080);
})();
```

With counters synchronized and stored in Redis database :

```js
const express = require('express');
const expressSession = require('express-session');
const expressVisitorCounter = require('express-visitor-counter');
const redis = require('redis');

const counters = {};
const redisClient = redis.createClient({ database: 1 });

(async () => {
  await redisClient.connect();

  const app = express();
  app.enable('trust proxy');
  app.use(expressSession({ secret: 'secret', resave: false, saveUninitialized: true }));
  app.use(expressVisitorCounter({ hook: counterId => counters[counterId] = (counters[counterId] || 0) + 1, redisClient }));
  app.get('/', (req, res, next) => res.json(counters));
  app.listen(8080);
})();
```

## Tests

The tests will use Mocha and require MongoDB and Redis to be running.

```bash
npm test
```
