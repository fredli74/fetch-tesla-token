# fetch-tesla-token
Simple node.js server for fetching Tesla tokens

# Why a server?
The Tesla SSO service is only designed to work from their app and website, and [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) are preventing us from accessing it from any other web page. The server acts as a proxy to bypass this and go through the sign in without storing any information.

# Is it safe?
Yes. But don't just trust my word, verify!

* It's open source
* Download and run locally
* Server only using node.js standard library (no node_modules needed)
* Client is single html file (no third-party browser libraries)
* Small code base, review it all in minutes

# How do I run it locally?
```bash
git clone https://github.com/fredli74/fetch-tesla-token.git
cd fetch-tesla-token/
npm run start
```
