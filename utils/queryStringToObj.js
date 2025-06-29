const querystring = require("querystring");

/**
 * Parses the 'result' string from an API response into an object.
 * @param {string} resultString - The result string to parse.
 * @returns {object} Parsed key-value pairs from the result string.
 */

function queryStringToObj(resultString) {
  if (!resultString || typeof resultString !== "string") {
    throw new Error("Invalid result string provided");
  }
  const normalObj = { ...querystring.parse(resultString) };
  return normalObj;
}

module.exports = queryStringToObj;
