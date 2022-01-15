/**
 * @file proxy function designed to work with AWS and Netlify lambda functions
 * @author Fredrik Lidström
 * @copyright 2019-2022 Fredrik Lidström
 * @license MIT (MIT)
*/

const { TRACE } = process.env;
const teslaAuth = require("../teslaAuth");

/**
 * Create a new session and return the sign in form
 *
 * @param {Object} event - ignored
 * @param {Object} context - ignored
 * @returns {Object} Response with { session, htmlForm }
*/
exports.handler = async function (event, context) {
  if (TRACE) console.log(`TRACE session(${JSON.stringify(event)}, ${JSON.stringify(context)}) called`);

  try {
    const data = await teslaAuth.newSession();

    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.log(`ERROR ${err.message}`);
    if (TRACE) console.log(`TRACE ${JSON.stringify(err)}`);

    return {
      statusCode: 500,
      headers: {
        "X-Error": err.message
      },
      body: err.message
    }
  }
}