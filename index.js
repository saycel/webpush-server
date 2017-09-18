const Sequelize   = require('sequelize');
const express     = require('express')
const bodyParser  = require('body-parser')
const chalk       = require('chalk');
const webpush     = require('web-push');

// Setup express
const port = process.env.PUSH_PORT || 3000;
const app = express();
app.set('json spaces', 40);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended : true }));

// Setup secret key (Internal validation for send push notification)
let secretKey = process.env.PUSH_SECRET || 'no_secure';
if (secretKey === 'no_secure') console.warn(chalk.bgRed('Warning: Using unsecure key'));

// Setup VAPID keys (Push notification)
let pushKeys;
if( typeof process.env.PUSH_PUBLIC !== 'undefined' && typeof process.env.PUSH_PRIVATE !== 'undefined') {
  pushKeys = {
    publicKey: process.env.PUSH_PUBLIC,
    privateKey:process.env.PUSH_PRIVATE
  };
} else {
  pushKeys = webpush.generateVAPIDKeys();
  console.warn(chalk.bgRed('Warning: Using random VAPID keys'));
}

// Start DB
const sequelize = new Sequelize('webphone', 'user', 'pwd', {
  host: 'localhost',
  dialect: 'sqlite',
  storage: './sqlite.db'
});

// Util function - Check data
const checkData = (fields, data) => {
  const noUndefined = fields.filter(field => typeof data[field] !== 'undefined').length;
  return new Promise((res, rej) => {
    (noUndefined === fields.length)? res(data) : rej("Invalid Data");
  })
};

// Util function - Check secret
const checkSecret = (secret, data) => {
  return new Promise((res, rej) => {
      (secret === data.secretKey)? res(data) : rej("Invalid Key");
  });
};

// Route - get public key
app.get('/publicKey', function (req, res) {
  res.json({ "key": pushKeys.publicKey });
})

// Route - save user data
app.post('/save', function (req, res) {
  checkData([ 'user', 'endpoint', 'auth', 'p256dh' ], req.body)
    .then( data => saveUser(data, pushKeys, (msg) => res.json(msg)))
    .catch( err => res.json({ error: err }));
});

// Route - send push notification
app.post('/send', function (req, res) {
  Promise.all([
    checkData([ 'user', 'secretKey', 'payload' ], req.body),
    checkSecret(secretKey, req.body)
  ])
  .then(() => sendPushNotification(req.body, (msg) => res.json(msg)))
  .catch( err => res.json({ error: err }));
});


/******************
 * User db model, methods for save or udpate
 * user, and for send push notifications.
*******************/

const UserPush = sequelize.define('user', {
  user:       { type: Sequelize.STRING },
  endpoint:   { type: Sequelize.STRING },
  auth:       { type: Sequelize.STRING },
  p256dh:     { type: Sequelize.STRING },
  publicKey:  { type: Sequelize.STRING },
  privateKey: { type: Sequelize.STRING }
});

const saveUser = (data, pushKeys, cb) => {
  const userData = {
    user: data.user,
    endpoint: data.endpoint,
    auth: data.auth,
    p256dh: data.p256dh,
    publicKey: pushKeys.publicKey,
    privateKey: pushKeys.privateKey
  };

  UserPush.sync().then(() => {
    UserPush.findOrCreate({ where: { user : data.user }, defaults: userData })
    .spread((user, created) => {
      if(!created) {
        user.updateAttributes(userData);
        cb({'status':'updated'});
        return;
      }
      cb({'status':'created'});
    })
    .catch(err => cb({'error':'Error saving user'}));
  });
}

const sendPushNotification = (data, cb) => {
  UserPush.sync().then(() => {
    UserPush.findOne({ where: {user: data.user } })
      .then(user => {
        if(user) {
          webpush.setVapidDetails('mailto:no-reply@webph.one', user.publicKey, user.privateKey);
          const pushSubscription = {
            endpoint: user.endpoint,
            keys: {
              auth: user.auth,
              p256dh: user.p256dh
            }
          };
          webpush.sendNotification(pushSubscription, data.payload)
            .then( (data) => cb(data))
            .catch( (err) => cb(err));
        } else {
          cb({'error':'User not found', id: data.user});
        }
      })
      .catch(() => {
          cb({'error':'User not found', data: err})
      });
  })
  .catch(err => cb({'error':'Error, table user not found'}));
};


// START EXPRESS
app.listen(3000, () => {
  console.log(chalk.green('Listening on port ' + port + ' - Secret key: ' + secretKey));
});