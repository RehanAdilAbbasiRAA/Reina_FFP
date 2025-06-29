const { TIMEDURATION } = require("../constants/index.constants");

const calculateDateFilter = filter => {
  const now = new Date();
  switch (filter) {
    case TIMEDURATION.ONE_DAY:
      return { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
    case TIMEDURATION.ONE_WEEK:
      return { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    case TIMEDURATION.ONE_MONTH:
      return { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
    case TIMEDURATION.THREE_MONTHS:
      return { $gte: new Date(now.setMonth(now.getMonth() - 3)) };
    case TIMEDURATION.ONE_YEAR:
      return { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
    default:
      return { $gte: new Date(now.setFullYear(now.getFullYear() - 2)) };
  }
};

module.exports = calculateDateFilter;
