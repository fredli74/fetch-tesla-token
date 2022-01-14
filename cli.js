/**
 * @file cli implementation to run teslaAuth.js
 * @author Fredrik Lidström
 * @copyright 2022 Fredrik Lidström
 * @license MIT (MIT)
*/

async function main() {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const teslaAuth = require("./teslaAuth");

    const session = teslaAuth.newSession();
    console.log(
        `Please copy and visit the URL below to start your Tesla SSO Authentication\n` +
        `\n` +
        `${session.url}\n` +
        `\n` +
        `Once Sign In is completed, copy the full landing page URL (https://auth.tesla.com/void/callback?code=...) and paste it below`
    );

    readline.question("url: ", async (url) => {
        try {
            const response = teslaAuth.decodeCallbackURL(url);
            if (response.state && response.state !== session.state) {
                console.error("Incorrect authentication response. State in requestion and authorization response do not match.");
            }

            console.log(`\nCollecting bearer token`);
            const bearer = await teslaAuth.bearerToken(response.code, session.codeVerifier, response.issuer);
            console.debug(bearer);

            console.log(`\nCollecting Owner-API token`);
            const ownerAPI = await teslaAuth.ownerapiToken(bearer.access_token);
            console.debug(ownerAPI);

            process.exit(0);
        } catch (error) {
            console.error(error.message);
            process.exit(-1);

        }
    });
}

main();