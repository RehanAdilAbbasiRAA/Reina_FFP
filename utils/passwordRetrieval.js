const bcrypt = require('bcrypt');

/**
 * Retrieve the original password by comparing with the hashed password
 * @param {string} inputPassword - The original password to verify
 * @param {string} hashedPassword - The hashed password from the database
 * @returns {string|null} - The original password if match is found, null otherwise
 */
const retrieveOriginalPassword = async (inputPassword, hashedPassword) => {
    try {
        const isMatch = await bcrypt.compare(inputPassword, hashedPassword);
        return isMatch ? inputPassword : null;
    } catch (error) {
        console.error('Error retrieving password:', error);
        return null;
    }
};

module.exports =  retrieveOriginalPassword ;