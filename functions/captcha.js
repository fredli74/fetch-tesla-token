/**
 * @file proxy function designed to work with AWS and Netlify lambda functions
 * @author Fredrik Lidström
 * @copyright 2021 Fredrik Lidström
 * @license MIT (MIT)
*/

const teslaAuth = require("../teslaAuth");

/**
 * Fetch captcha image
 *
 * @param {Object} event - { body: { session } }
 * @param {Object} context - ignored
 * @returns {Object} Response "captcha" image with dataURI
*/
exports.handler = async function (event, context) {
  console.log(`TRACE captcha(${JSON.stringify(event)}, ${JSON.stringify(context)}) called`);

  try {
    const input = event.body && JSON.parse(event.body);

    // Get captcha image and convert it into a dataURI
    const data = await teslaAuth.getCaptcha(input.session);

    // Return a mix of bearer and api access tokens
    return {
      statusCode: 200,
      body: JSON.stringify({
        reponse: "captcha",
        image: data,
      })
    };

  } catch (err) {
    console.log(`ERROR ${err.message}`);
    console.log(`TRACE ${JSON.stringify(err)}`);

    return {
      statusCode: 500,
      headers: {
        "X-Error": err.message
      },
      body: err.message
    }
  }
}