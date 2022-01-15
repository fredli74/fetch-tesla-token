# fetch-tesla-token
Simple node.js server for fetching Tesla tokens

# Why a server?
The Tesla APIs are only intended for the official Tesla App, therefore there are deliberate limitations that prevent the ease of use for third party solutions. One of those limitations is that [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) prevents any other domain than tesla.com to access the API directly from a browser. Calling the API from a node.js server works fine.

# How does it work?
Tesla is constantly seeking ways to make their sign in more secure, and when they do, third party solutions tends to break. I finally came to the conclusion that the best way forward is to use the official sign in flow as much as possible. An added benefit to this decision is that users email, password, and MFA codes are never entered or proxied through this server, they are only used directly on the official secure Tesla page. The drawback is that it requires an additional manual step by the user at the end.

1. The server generates a random session id and creates a unique sign in link to tesla.com

2. The user visit the link and sign in

3. Once signed in, the user is redirected to a page on tesla.com that does not exist. This is how Tesla uses it internally and it is intentional. 

<img src="/screenshot.png" width="50%">

4. The user copies the **full url** *`https://auth.tesla.com/void/callback?code=...`* and provides it to this server.

5. The server decode the url and then call the Tesla Authentication servers to generate bearer and owner-api tokens.


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

Or use the simple command-line version with
```bash
npm run cli

```
