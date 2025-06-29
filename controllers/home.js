const User = require("../models/user");

const getIndex = async (req, res) => {
  try {
    return res.status(200).json({message:"SERVER HIT UPDATED TWICE FINAAAAAAAAAAl AGAAIN "});
  } catch (error) {
    console.log(error);
  }
};

module.exports = {
  getIndex,
};
