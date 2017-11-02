const Sequelize   = require('sequelize');
const express     = require('express')
const bodyParser  = require('body-parser')
const chalk       = require('chalk');
const webpush     = require('web-push');
const kamaiJson   = require('./utils/kamailioJson')
const uuid = require('uuid/v4');

// Setup express
const port = process.env.PUSH_PORT || 3000;
const app = express();
app.set('json spaces', 40);

app.use(kamaiJson);

//app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended : true }));

// Enable CROSS
/*app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
*/


// Setup secret key (Internal validation for send push notification)
let secretKey = process.env.PUSH_SECRET || 'bm9fc2VjdXJl';
if (secretKey === 'bm9fc2VjdXJl') console.warn(chalk.bgRed('Warning: Using unsecure secret key'));

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
  .then(() => sendPushNotification(req.body, (msg) => {
    if(!res.headersSent) {
      res.json(msg)}
    }
  ))
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
    .catch(err => cb({ error: 'Error saving user'}));
  });
}
let pendingPushNotifications = [];
const rejectCall = (id, status = 'rejected') => {
  try {
    pendingPushNotifications = pendingPushNotifications.filter(x => x.id === id);
  } catch (error) {
    
  }
}

app.get('/reject/:id', function (req, res) {
  const id = req.params.id;
  rejectCall(id);
  res.json({status: 'rejected'});
});


const sendPushNotification = (data, cb) => {
  UserPush.sync().then(() => {
    UserPush.findAll({ where: {user: data.user } })
      .then(users => {
        if(users.length > 0) {
          let result = users.map( user => {
            const id = uuid();
            
            webpush.setVapidDetails('mailto:no-reply@webph.one', user.publicKey, user.privateKey);
            const pushSubscription = {
              endpoint: user.endpoint,
              keys: {
                auth: user.auth,
                p256dh: user.p256dh
              }
            };
            webpush.sendNotification(pushSubscription, JSON.stringify(
              {
                notification: {
                  title: 'Webph.one',
                  data: Object.assign({}, data.payload, {id: id})
                }
              }))
              .then( (data) => {
                console.log('Waiting for reply - ', id)
                setTimeout(()=> rejectCall(id, 'timeout'), 40000);
                pendingPushNotifications.push({ id });
              })
              .catch( (err) => {
                console.error('Error sending push notifications', err)
                cb({ error: 'Error sending push notificactions', data: err})
              });
          })
          cb({result: 'Sending push notificactions'});
        } else {
        cb({ error :'User not found', id: data.user});
        }
      })
      .catch(() => {
          cb({ error :'Table User not found', data: err})
      });
  })
  .catch(err => cb({ error :'Error, table user not found'}));
};


/******************
 * After call survey
*******************/
app.post('/survey', function (req, res) {
  checkData([], req.body)
    .then( data => saveSurvey(data, (msg) => res.json(msg)))
    .catch( err => res.json({ error: err }));
});


const Survey = sequelize.define('survey', {
  rating:    { type: Sequelize.STRING },
  issues:    { type: Sequelize.STRING },
  comments:  { type: Sequelize.STRING },
  timestamp: { type: Sequelize.STRING },
  user:      { type: Sequelize.STRING },
  branch:    { type: Sequelize.STRING },
  revision:  { type: Sequelize.STRING }
});

const saveSurvey = (data, cb) => {
  const surveyData = {
    rating: data.rating || '',
    issues: data.issues || '',
    comments: data.comments || '',
    timestamp: data.timestamp || '',
    user: data.user || '',
    branch: data.branch || 'no-branch',
    revision: data.revision || 'no-revision'
  };

  Survey.sync().then(() => {
    Survey.create(surveyData)
    .spread((user, created) => {
      cb({'status':'200'});
    })
    .catch(err => cb({ error: 'Error saving survey'}));
  });
}

app.get('/survey', function (req, res) {
  Survey.sync().then(() => {
    Survey.findAll().then((data)=> {
      res.json(data)
    })
  })
});

/******************
 * Feedback
*******************/
app.post('/feedback', function (req, res) {
  checkData([], req.body)
    .then( data => saveFeedback(data, (msg) => res.json(msg)))
    .catch( err => res.json({ error: err }));
});


const Feedback = sequelize.define('feedback', {
  comment:  { type: Sequelize.STRING },
  user:      { type: Sequelize.STRING },
  branch:    { type: Sequelize.STRING },
  revision:  { type: Sequelize.STRING }
});

const saveFeedback = (data, cb) => {
  const feedbackData = {
    user: data.user || 'no-user',
    comment: data.comment || 'no-comment',
    branch: data.branch || 'no-branch',
    revision: data.revision || 'no-revision'
  };

  Feedback.sync().then(() => {
    Feedback.create(feedbackData)
    .spread((feedback, created) => {
      cb({'status':'200'});
    })
    .catch(err => cb({ error: 'Error saving feedback'}));
  });
}

app.get('/feedback', function (req, res) {
  Feedback.sync().then(() => {
    Feedback.findAll().then((data)=> {
      res.json(data)
    })
  })
});

// START EXPRESS
app.listen(3000, () => {
  console.log(chalk.green('Listening on port ' + port + ' - Secret key: ' + secretKey));
});