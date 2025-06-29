const ApiLog = require("../models/log");
// Create a function to log cron job execution
const logCronJob = async (action, details = {}) => {
  try {
    const logEntry = {
      method: 'CRON',
      url: '/cron/trading-accounts-balance',
      route: '/cron/trading-accounts-balance',
      params: {},
      query: {},
      body: details,
      userAgent: 'System',
      userId: null,
      userName: null,
      userEmail: null,
      userRole: 'System',
      statusCode: 200,
      responseTime: 0,
      description: `System job ${action} executed`
    };

    await new ApiLog(logEntry).save();
    console.log(`[CRON LOG] ${action} executed and logged to database`);
  } catch (error) {
    console.error(`Error logging cron job ${action}:`, error);
  }
};
module.exports = logCronJob;