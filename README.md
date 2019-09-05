# fetch-tesla-token
Super simple node.js proxy for fetching Tesla API tokens

# Why a proxy?
The Tesla API was not intended for direct use in browsers and [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) is preventing it. The server acts as a simple proxy to bypass this without storing any information.

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

# Do I really have to go through all this for a token?
Nope. I made this just to have a nice interface for getting your tokens. If you're hard-core, you can just curl your token directly.

https://gist.github.com/fredli74/67b9f4a72705dd0644e0eeadc6e4c91f