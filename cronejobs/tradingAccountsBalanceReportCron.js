const os = require("os");
require("dotenv").config({ path: "./.env" });
const cron = require("node-cron");
const async = require("async");
const axios = require("axios");
const mongoose = require("mongoose");
// Import axios-retry
const TradingAccountsBalanceReport = require("../models/tradingAccountsBalanceReport");
const MatchTraderTradingAccount = require("../models/matchTraderTraddingAccount");
const PaymentPlan = require("../models/paymentPlans");

// Global Error Handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
  process.exit(1); // Exit to trigger PM2 restart
});

// AWS EC2-Specific Load Metrics
const getEC2LoadMetrics = () => {
  const cpuCores = os.cpus().length; // Get total vCPUs on EC2
  const cpuLoad = os.loadavg()[0] / cpuCores; // Normalize CPU load by core count
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100; // Memory usage in %

  return { cpuLoad, memoryUsage, cpuCores };
};

// MongoDB Connection
const connectDB = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("MongoDB connected successfully for Cron Job");
    }
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1); // Exit the process if unable to connect
  }
};

// New Method: Get Trading Account Details using Login directly
const getTradingAccountDetailsByLogin = async login => {
  try {
    if (!process.env.MATCH_TRADE_SYSTEM_UUID) {
      console.error("System UUID not found in environment variables");
      return { success: false, message: "System UUID not configured" };
    }

    const config = {
      method: "get",
      url: `${process.env.MATCH_TRADE_API_URL}trading-account`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      params: {
        systemUuid: process.env.MATCH_TRADE_SYSTEM_UUID,
        login: login,
      },
    };

    const response = await axios(config);
    if (response.status !== 200) {
      return { success: false, message: "Failed to fetch account details" };
    }

    return {
      success: true,
      message: "Trading Account details fetched successfully",
      data: response.data.financeInfo,
    };
  } catch (error) {
    console.error("Error fetching Trading Account details:", error);
    return { success: false, message: "Error in API request" };
  }
};

// Process Account Data and Prepare for Batch Save
const prepareAccountData = async account => {
  try {
    // Directly using login to fetch details
    const result = await getTradingAccountDetailsByLogin(account.login);

    if (result.success && result.data) {
      // Prepare data for batch saving
      return {
        accountId: account.accountId || null,
        login: account.login || null,
        status: account.status || null,
        currency: result.data.currency || null,
        balance: result.data.balance ? result.data.balance.toFixed(2) : "0.00",
        credit: result.data.credit ? result.data.credit.toFixed(2) : "0.00",
        equity: result.data.equity ? result.data.equity.toFixed(2) : "0.00",
        pnl: result.data.profit ? result.data.profit.toFixed(2) : "0.00",
        marginAvailable: result.data.freeMargin
          ? result.data.freeMargin.toFixed(2)
          : "0.00",
        marginUsed: result.data.margin ? result.data.margin.toFixed(2) : "0.00",
        userId: account.userId,
        matchTraderTradingAccountId: account._id,
      };
    } else {
      console.error(
        `Failed to get details for accountId: ${account.accountId}`,
      );
      return null;
    }
  } catch (error) {
    console.error(`Error processing accountId: ${account.accountId}`, error);
    return null;
  }
};

// Main function to execute cron job logic
const runCronJob = async () => {
  console.log("Cron job for Account Balanace Update started...");

  try {
    const batchSize = 100;
    let skip = 0;

    while (true) {
      // Fetching trading accounts with lean queries and projections
      const accounts = await MatchTraderTradingAccount.find(
        {},
        { accountId: 1, userId: 1, login: 1, status: 1 },
      )
        .skip(skip)
        .limit(batchSize)
        .lean();

      // Break the loop if no more accounts are found
      if (accounts.length === 0) break;

      console.log(`Processing batch with ${accounts.length} accounts`);

      // Dynamic concurrency limit based on number of accounts
      const concurrencyLimit = Math.min(
        10,
        Math.floor(accounts.length / 20) + 5,
      );

      // Collect data for batch saving
      const dataToSave = [];

      // Using async.eachLimit for threading and concurrency control
      await async.eachLimit(accounts, concurrencyLimit, async account => {
        const reportData = await prepareAccountData(account);
        if (reportData) {
          dataToSave.push(reportData);
        }
      });

      // Save all data at once using insertMany()
      if (dataToSave.length > 0) {
        await TradingAccountsBalanceReport.insertMany(dataToSave);
        console.log(`Batch of ${dataToSave.length} records saved.`);
      } else {
        console.log("No valid data to save for this batch.");
      }

      // Move to the next batch
      skip += batchSize;
    }

    console.log("Cron job completed successfully");
  } catch (error) {
    console.error("Error in runCronJob:", error);
  }
};

//////////Method for Account Status //////////////////////////////////

const updateAccountStatus = async (accountId, challengeId, status) => {
  try {
    const url = `${process.env.MATCH_TRADE_API_URL}prop/accounts`;
    const config = {
      method: "put",
      url: url,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      data: {
        accountId: accountId,
        challengeId: challengeId,
        phaseStep: 1,
        status: status, // INACTIVE for BREACHED, ACTIVE for FUNDED
        tradingDays: 0,
      },
    };

    const response = await axios(config);
    if (response.status === 200) {
      console.log(
        `Account ${accountId} successfully updated to status: ${status}`,
      );
      return { success: true, message: "Account status updated successfully" };
    } else {
      console.error(
        `Failed to update account ${accountId}, Response: `,
        response.data,
      );
      return { success: false, message: "Failed to update account status" };
    }
  } catch (error) {
    console.error("Error updating account status:", error);
    return { success: false, message: "Error in API request" };
  }
};

// Function to fetch today's closed trading positions
const getTodayClosedPositions = async login => {
  try {
    const now = new Date();

    // Get the timezone offset in minutes and convert to milliseconds
    const timezoneOffset = now.getTimezoneOffset() * 60 * 1000;

    // Get the local midnight (00:00:00)
    const todayStart = new Date(now.setHours(0, 0, 0, 0) - timezoneOffset);

    // Get the local end of the day (23:59:59.999)
    const todayEnd = new Date(now.setHours(23, 59, 59, 999) - timezoneOffset);

    // Prepare API request
    const config = {
      method: "get",
      url: `${process.env.MATCH_TRADE_API_URL}trading-accounts/trading-data/closed-positions`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      params: {
        systemUuid: process.env.MATCH_TRADE_SYSTEM_UUID,
        login: login,
        // from: "2025-02-25T00:00:00.000Z",
        // to: "2025-02-25T23:59:59.999Z",
        from: todayStart,
        to: todayEnd,
      },
    };

    // Call API
    const response = await axios(config);
    if (response.status !== 200) {
      return { success: false, message: "Failed to fetch closed positions" };
    }

    return {
      success: true,
      message: "Closed positions fetched successfully",
      data: response.data.closedPositions || [],
    };
  } catch (error) {
    console.error("Error fetching closed positions:", error);
    return { success: false, message: "Internal server error", data: [] };
  }
};

// Function to calculate daily drawdown and update status if breached
const checkDailyDrawdown = async (account, maxDailyDrawdown, ruleId) => {
  try {
    console.log(`Checking daily drawdown for account: ${account._id}`);

    // Fetch closed trades for today
    const tradeData = await getTodayClosedPositions(account.login);
    if (!tradeData.success || !tradeData.data.length) {
      console.log(`No trades found for account: ${account._id}`);
      return false;
    }

    // Calculate total net profit of today's trades
    const netProfitSum = tradeData.data.reduce(
      (sum, trade) => sum + trade.netProfit,
      0,
    );

    console.log(`Total Net Profit for ${account._id}: ${netProfitSum}`);

    // Compare net profit with maxDailyDrawdown
    if (netProfitSum < 0 && Math.abs(netProfitSum) >= maxDailyDrawdown) {
      await MatchTraderTradingAccount.updateOne(
        { _id: account._id },
        {
          $set: {
            status: "BREACHED",
            reason: "Daily Draw Down Reached",
          },
        },
      );
      console.log(`Account ${account.accountId} marked as BREACHED`);
      try {
        // Call API to update status in external system
        await updateAccountStatus(account.accountId, ruleId, "INACTIVE");
      } catch (err) {
        console.error(
          `Failed to update account status in match trader for ${account.accountId}:`,
          err,
        );
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error checking daily drawdown for ${account._id}:`, error);
    return false;
  }
};

// Function to process each account
const processAccount = async account => {
  try {
    console.log(`Processing Account: ${account.accountId}`);

    // Fetch payment plan
    const plan = await PaymentPlan.findById(account.planId).lean();
    if (!plan || !plan.fundingOptions) {
      console.error(`Plan not found for planId: ${account.phase}`);
      return;
    }

    const totalPhases = plan.fundingOptions
      ? Object.keys(plan.fundingOptions).length
      : 0;

    if (account.phase > totalPhases || totalPhases == 0) {
      console.error(
        `Invalid phase: ${account.phase} for account: ${account.accountId} and total phases: ${totalPhases}`,
      );
      return;
    }

    // Dynamically get the correct phase from fundingOptions
    const currentPhase =
      plan.fundingOptions[`phase${account.phase}`] ||
      plan.fundingOptions.funded ||
      null;

    if (currentPhase == null) {
      console.error(
        `Phase data not found for phase ${account.phase} for account: ${account.accountId}`,
      );
      return;
    }

    let { maxDrawdown, profitTarget, maxDailyDrawdown } = currentPhase;
    maxDailyDrawdown =
      (parseFloat(maxDailyDrawdown.replace("%", "")) / 100) * plan.accountSize;
    maxDrawdown =
      (parseFloat(maxDrawdown.replace("%", "")) / 100) * plan.accountSize;
    profitTarget =
      (parseFloat(profitTarget.replace("%", "")) / 100) * plan.accountSize;

    //first check Daily Draw Down
    const dailyDrawDownCheck = await checkDailyDrawdown(
      account,
      maxDailyDrawdown,
      plan.ruleId,
    );
    if (dailyDrawDownCheck) return;

    // Fetch trading details
    const tradingDetails = await getTradingAccountDetailsByLogin(account.login);
    if (!tradingDetails.success || !tradingDetails.data) {
      console.error(`Failed to fetch trading details for ${account.accountId}`);
      return;
    }

    const { balance } = tradingDetails.data;

    const netProfit = plan.accountSize - balance;

    // **Check if the account is breached**
    if (netProfit < 0 && Math.abs(netProfit) >= maxDrawdown) {
      await MatchTraderTradingAccount.updateOne(
        { _id: account._id },
        { $set: { status: "BREACHED", reason: "Maximum Draw Down Reached" } },
      );
      console.log(
        `Account ${account.accountId} marked as BREACHED due to maximum draw down`,
      );
      try {
        // Call API to update status in external system
        await updateAccountStatus(account.accountId, plan.ruleId, "INACTIVE");
      } catch (err) {
        console.error(
          `Failed to update account status in match trader for ${account.accountId}:`,
          err,
        );
      }
      return;
    }

    // **Check if the account qualifies for the next phase or funding**
    if (netProfit >= profitTarget) {
      if (account.phase < totalPhases - 1) {
        await MatchTraderTradingAccount.updateOne(
          { _id: account._id },
          { $inc: { phase: 1 } }, // Move to next phase
        );
        console.log(
          `Account ${account.accountId} advanced to phase ${account.phase + 1}`,
        );
      } else {
        await MatchTraderTradingAccount.updateOne(
          { _id: account._id },
          {
            $set: { status: "FUNDED", reason: "Profit Target Completed" },
            $inc: { phase: 1 },
          },
        );
        console.log(`Account ${account.accountId} marked as FUNDED`);
      }

      try {
        // Call API to update status in external system
        await updateAccountStatus(account.accountId, plan.ruleId, "ACTIVE");
      } catch (err) {
        console.error(
          `Failed to update account status in match trader for ${account.accountId}:`,
          err,
        );
      }
    }
  } catch (error) {
    console.error(`Error processing account ${account.accountId}:`, error);
  }
};

// Main Function
const runEveryFiveMinutes = async () => {
  console.log("Running Every 5 Minutes Cron Job...");
  await connectDB();

  try {
    const accounts = await MatchTraderTradingAccount.find(
      { status: { $in: ["ACTIVE", "FUNDED"] } },
      { accountId: 1, userId: 1, login: 1, phase: 1, planId: 1 },
    ).lean();

    console.log(`Total Active/Funded Accounts Found: ${accounts.length}`);

    // Get EC2 system load
    const { cpuLoad, memoryUsage, cpuCores } = getEC2LoadMetrics();
    console.log(
      `CPU Load: ${cpuLoad.toFixed(2)} (Cores: ${cpuCores}), Memory Usage: ${memoryUsage.toFixed(2)}%`,
    );

    // Base concurrency on total accounts
    let concurrencyLimit = Math.min(50, Math.ceil(accounts.length / 200));
    concurrencyLimit = Math.max(concurrencyLimit, 10); // Ensure minimum concurrency

    // **EC2-Specific Adjustments**
    if (cpuLoad > 0.7) concurrencyLimit = Math.max(concurrencyLimit - 10, 5); // Reduce if CPU load is high
    if (cpuCores <= 2) concurrencyLimit = Math.min(concurrencyLimit, 10); // Limit for low-core instances

    console.log(`Adjusted Concurrency Limit: ${concurrencyLimit}`);

    await async.eachLimit(accounts, concurrencyLimit, async account => {
      await processAccount(account);
    });

    console.log("Cron job completed successfully");
  } catch (error) {
    console.error("Error in runEveryFiveMinutes:", error);
  }
};

//******************************
//******************************
//******************************
//  used for live working  ///
//******************************
//******************************
//******************************

// Schedule the cron job to run every hour
// cron.schedule("0 * * * *", async () => {
//   console.log("Running TradingAccountsBalanceReport Cron Job");
//   await connectDB();
//   await runCronJob();
// });

// // Schedule the cron job to run every 5 minutes
// cron.schedule("*/5 * * * *", async () => {
//   await runEveryFiveMinutes();
// });

//******************************
//******************************
//******************************
//////  used for testing ///////
//******************************
//******************************
//******************************

// Run the cron job immediately for testing
// (async () => {
//   //   console.log("Running 5min Cron Job (Immediate Test)");
//   await runEveryFiveMinutes();
// })();

// Run the cron job immediately for testing
// (async () => {
//   //   console.log("Running TradingAccountsBalanceReport Cron Job (Immediate Test)");
//   await connectDB();
//   await runCronJob();
// })();
