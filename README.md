# Express-Visitor-Counter

[![npm version](https://badge.fury.io/js/express-visitor-counter.svg)](https://www.npmjs.com/package/express-visitor-counter)

Express middleware to count visitors using IP address and cookies.
The middleware will increment 3 counters :

- `requests-dd-mm-yyyy` : number of daily HTTP requests received by the server
- `visitors-dd-mm-yyyy` : number of daily unique visitors on your website
- `ip-addresses-dd-mm-yyyy` : number of daily unique ip addresses which hit your server

## Installation

```bash
npm i express-visitor-counter
```

## Usage

The middleware needs the Express option `trust proxy` to be set to true and the `express-session` middleware.

With a MongoDB collection :

```js
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

## Tests

The tests will use Mocha and require MongoDB to be launched.

```bash
npm test
```
