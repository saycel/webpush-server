# Web push notification server

This script allows you to:
* Generate the necessary keys for webpush
* Expose the public key to the client
* Register and update user subscriptions.
* Send notifications to users by their number

Keys are randomly generated at startup or can be set using environment variables (PUSH_PUBLIC and PUSH_PRIVATE). The same for the express port (PUSH_PORT) and the secret key (PUSH_SECRET)

## Methods

#### http://url:port/publicKey
Displays the public key needed for the webApp to generate its credentials

#### http://url:port/save
Creates or updates the user record in the database
This method requires the following data:
```json
{
    "user": "user number",
    "endpoint": "endpoint generate by the webapp subscription",
    "auth": "auth key generate by the webapp subscription",
    "p256dh": "p256dh generate my the webapp subrcription"
}
```

#### http://url:port/send
Send a push notification to the user. You need to have the secret key to enable sending.
This method requires the following data:
```json
{
    "user": "user number",
    "secretKey": "secret key set in the server",
    "payload": "data sent with the push message"
}
```