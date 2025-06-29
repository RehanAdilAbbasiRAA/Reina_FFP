require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");

const User = require("../models/user");
const MatchTraderTradingAccount = require("../models/matchTraderTraddingAccount");
const PaymentPlan = require("../models/paymentPlans");
const TradingAccountBalanceReport = require("../models/tradingAccountsBalanceReport");

const systemUuid = process.env.MATCH_TRADE_SYSTEM_UUID;

// Axios Wrapper for consistent error handling
const axios = require("axios");
const sendEmail = require("../utils/sendEmail");

const axiosWrapper = async config => {
  try {
    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("Axios Error:", error.response?.data || error.message);
    return {
      success: false,
      statusCode: error.response?.status || 500,
      message: error.response?.data?.message || "Internal Server Error",
      data: error.response?.data || null,
    };
  }
};

// Function to generate a random 8-character password
const generateRandomPassword = () => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let password = "";
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Function to create Match Trade account and update user in DB using axiosWrapper
const createMatchTradeAccount = async userId => {
  try {
    const user = await User.findById(userId);
    if (!user) return { success: false, message: "User not found" };

    if (user.matchTraderAccountDetails) {
      return {
        success: true,
        message: "Account already exists",
        data: user.matchTraderAccountDetails,
      };
    }

    const password = generateRandomPassword();

    const requestData = {
      email: user.email,
      password: password,
      personalDetails: {
        firstname: user.firstName,
        lastname: user.lastName,
      },
    };

    const config = {
      method: "post",
      url: `${process.env.MATCH_TRADE_API_URL}accounts`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      data: requestData,
    };

    const response = await axiosWrapper(config);

    if (!response.success) return response;

    user.matchTraderAccountDetails = response.data;
    user.matchTraderAccountDetails.password = password;
    await user.save();

    return {
      success: true,
      message: "Account created successfully",
      data: response.data,
    };
  } catch (error) {
    console.error("Error creating Match Trade account:", error);
    throw error;
  }
};

// Function to create Match Trade Trading Account using axiosWrapper
const createMatchTradeTradingAccount = async (userId, planId, paymentId) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(planId) ||
      !mongoose.Types.ObjectId.isValid(paymentId)
    ) {
      console.error("Invalid planId or paymentId");
      return { success: false, message: "Invalid planId or paymentId" };
    }

    const user = await User.findById(userId);
    if (!user) return { success: false, message: "User not found" };

    if (
      !user.matchTraderAccountDetails ||
      !user.matchTraderAccountDetails.uuid
    ) {
      console.error("User does not have a Match Trade account");
      return {
        success: false,
        message: "User does not have a Match Trade account. Create that first.",
      };
    }

    const plan = await PaymentPlan.findById(planId);
    if (!plan) return { success: false, message: "Payment Plan not found" };

    const requestData = {
      challengeId: plan.ruleId, // Use ruleId as challengeId
      accountUuid: user.matchTraderAccountDetails.uuid,
    };

    const config = {
      method: "post",
      url: `${process.env.MATCH_TRADE_API_URL}prop/accounts?instantlyActive=true&phaseStep=1`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      data: requestData,
    };

    const response = await axiosWrapper(config);
    if (!response.success) return response;

    const tradingAccount = new MatchTraderTradingAccount({
      userId: user._id,
      paymentId: paymentId,
      planId: planId,
      accountId: response.data.id,
      login: response.data.login,
      accountCreatedResponse: response.data,
      status: "ACTIVE",
    });

    await tradingAccount.save();

    user.matchTraderTraddingAccountIds.push({
      tradingAccountId: tradingAccount._id, // Reference to MatchTraderTradingAccount document
      accountId: response.data.id, // Match Trader API accountId
    });
    await user.save();

    return {
      success: true,
      message: "Trading account created successfully",
      data: tradingAccount,
    };
  } catch (error) {
    console.error("Error creating Match Trade Trading Account:", error);
    throw error;
  }
};

// Function to create both Match Trade Account and Trading Account
const createMatchTradeAccountAndTradingAccount = async (
  userId,
  planId,
  paymentId,
) => {
  try {
    // Step 1: Create Match Trade Account
    const accountCreationResult = await createMatchTradeAccount(userId);
    if (!accountCreationResult.success) {
      console.error(
        "Error in creating Match Trade Account:",
        accountCreationResult.message,
      );
      return accountCreationResult;
    }

    // Step 2: Create Match Trade Trading Account
    const tradingAccountResult = await createMatchTradeTradingAccount(
      userId,
      planId,
      paymentId,
    );
    return tradingAccountResult;
  } catch (error) {
    console.error("Error in createMatchTradeAccountAndTradingAccount:", error);
    throw error;
  }
};

// Function to get Trading Account Details by accountId using axiosWrapper
const getTradingAccountDetails = async accountId => {
  try {
    const tradingAccount = await MatchTraderTradingAccount.findOne({
      accountId,
    });
    if (!tradingAccount)
      return { success: false, message: "Trading Account not found" };

    if (!systemUuid) {
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
        systemUuid: systemUuid,
        login: tradingAccount.login,
      },
    };

    const response = await axiosWrapper(config);
    if (!response.success) return response;

    return {
      success: true,
      message: "Trading Account details fetched successfully",
      data: response.data.financeInfo,
    };
  } catch (error) {
    console.error("Error fetching Trading Account details:", error);
    throw error;
  }
};

// Function to get MatchTraderTradingAccount by accountId
const getMatchTraderTradingAccountByAccountId = async accountId => {
  try {
    const tradingAccount = await MatchTraderTradingAccount.findOne({
      accountId,
    });

    if (!tradingAccount) {
      return { success: false, message: "Trading account not found" };
    }

    return {
      success: true,
      message: "Trading account found successfully",
      data: tradingAccount,
    };
  } catch (error) {
    console.error("Error fetching Match Trader Trading Account:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
};

// Function to get open positions using accountId
const getOpenPositionsByAccountId = async accountId => {
  try {
    // Step 1: Use the previously created method to get trading account details
    const result = await getMatchTraderTradingAccountByAccountId(accountId);

    if (!result.success) {
      return result; // Return error if trading account not found
    }

    const tradingAccount = result.data;

    // Step 2: Extract login from the trading account
    const { login } = tradingAccount;
    if (!login) {
      return { success: false, message: "Login not found in trading account" };
    }

    // Step 3: Prepare the API request configuration
    const config = {
      method: "get",
      url: `${process.env.MATCH_TRADE_API_URL}trading-accounts/trading-data/open-positions`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      params: {
        systemUuid: systemUuid,
        login: login,
      },
    };

    // Step 4: Call the API using axiosWrapper
    const response = await axiosWrapper(config);
    if (!response.success) return response;

    // Step 5: Return the data from the API response
    return {
      success: true,
      message: "Open positions fetched successfully",
      data: response.data,
    };
  } catch (error) {
    console.error("Error fetching open positions:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
};

// Function to get closed positions using accountId
const getClosedPositionsByAccountId = async (
  accountId,
  from = null,
  to = null,
) => {
  try {
    // Reuse the previously created method to get trading account details
    const result = await getMatchTraderTradingAccountByAccountId(accountId);

    if (!result.success) {
      return result; // Return error if trading account not found
    }

    const tradingAccount = result.data;

    // Extract login from the trading account
    const { login } = tradingAccount;
    if (!login) {
      return { success: false, message: "Login not found in trading account" };
    }
    // Construct request params
    const params = {
      systemUuid: systemUuid,
      login: tradingAccount.login,
    };

    if (from) params.from = from;
    if (to) params.to = to;

    // Prepare the API request configuration
    const config = {
      method: "get",
      url: `${process.env.MATCH_TRADE_API_URL}trading-accounts/trading-data/closed-positions`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      params,
    };

    // Call the API using axiosWrapper
    const response = await axiosWrapper(config);
    if (!response.success) return response;

    // Return the data from the API response
    return {
      success: true,
      message: "Closed positions fetched successfully",
      data: response.data,
    };
  } catch (error) {
    console.error("Error fetching closed positions:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
};

// Function to get active orders using accountId
const getActiveOrdersByAccountId = async accountId => {
  try {
    // Reuse the previously created method to get trading account details
    const result = await getMatchTraderTradingAccountByAccountId(accountId);

    if (!result.success) {
      return result; // Return error if trading account not found
    }

    const tradingAccount = result.data;

    // Extract login from the trading account
    const { login } = tradingAccount;
    if (!login) {
      return { success: false, message: "Login not found in trading account" };
    }

    // Prepare the API request configuration
    const config = {
      method: "get",
      url: `${process.env.MATCH_TRADE_API_URL}trading-accounts/trading-data/active-orders`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      params: {
        systemUuid: systemUuid,
        login: login,
      },
    };

    // Call the API using axiosWrapper
    const response = await axiosWrapper(config);
    if (!response.success) return response;

    // Return the data from the API response
    return {
      success: true,
      message: "Active orders fetched successfully",
      data: response.data,
    };
  } catch (error) {
    console.error("Error fetching active orders:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
};

// Function to get ledgers using accountId and type with validation
const getLedgersByAccountId = async (accountId, type) => {
  try {
    // Enum values for types
    const validTypes = [
      "DEPOSIT",
      "WITHDRAWAL",
      "CREDIT_IN",
      "CREDIT_OUT",
      "AGENT_COMMISSION",
      "COMMISSIONS",
      "SWAPS",
      "CLOSED_POSITION",
    ];

    // Validate type
    if (!validTypes.includes(type)) {
      return {
        statusCode: 400,
        success: false,
        message: `Invalid type. Allowed values: ${validTypes.join(", ")}`,
      };
    }

    // Reuse the previously created method to get trading account details
    const result = await getMatchTraderTradingAccountByAccountId(accountId);

    if (!result.success) {
      return result; // Return error if trading account not found
    }

    const tradingAccount = result.data;

    // Extract login from the trading account
    const { login } = tradingAccount;
    if (!login) {
      return { success: false, message: "Login not found in trading account" };
    }

    // Prepare the API request configuration
    const config = {
      method: "get",
      url: `${process.env.MATCH_TRADE_API_URL}trading-accounts/trading-data/ledgers`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      params: {
        systemUuid: systemUuid,
        login: login,
        types: type,
      },
    };

    // Call the API using axiosWrapper
    const response = await axiosWrapper(config);
    if (!response.success) return response;

    // Return the data from the API response
    return {
      success: true,
      message: "Ledgers fetched successfully",
      data: response.data,
    };
  } catch (error) {
    console.error("Error fetching ledgers:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
};

// Function to change password using userId and update User model
const changePasswordByUserId = async (userId, newPassword) => {
  try {
    // Step 1: Find the user by userId
    const user = await User.findById(userId);

    if (!user) {
      return { success: false, message: "User not found" };
    }

    // Step 2: Get accountUuid from matchTraderAccountDetails
    const accountUuid = user.matchTraderAccountDetails?.uuid;

    if (!accountUuid) {
      return {
        success: false,
        message: "Account UUID not found in user details",
      };
    }

    // Step 3: Prepare the API request configuration
    const config = {
      method: "post",
      url: `${process.env.MATCH_TRADE_API_URL}change-password`,
      headers: {
        Authorization: process.env.MATCH_TRADING_API_KEY,
        "Content-Type": "application/json",
      },
      data: {
        accountUuid: accountUuid,
        newPassword: newPassword,
      },
    };

    // Step 4: Call the API using axiosWrapper
    const response = await axiosWrapper(config);

    if (!response.success) return response;

    // Step 5: If password change is successful, update the User model
    user.matchTraderAccountDetails.password = newPassword;
    user.markModified("matchTraderAccountDetails");
    await user.save();

    return {
      success: true,
      message: "Password changed successfully",
    };
  } catch (error) {
    console.error("Error changing password:", error);
    return {
      success: false,
      message: "Internal server error",
    };
  }
};

const tradeHistoryResponse = closedPositions => {
  return {
    deal_history: closedPositions.map(position => ({
      Ticket: position.id,
      Type:
        position.side.charAt(0).toUpperCase() +
        position.side.slice(1).toLowerCase(),
      "Open Time": moment(position.openTime)
        .tz("UTC")
        .format("DD MMM YYYY hh:mm A [UTC]"),
      "Close Time": position.time
        ? moment(position.time).tz("UTC").format("DD MMM YYYY hh:mm A [UTC]")
        : "N/A",
      Symbol: position.symbol,
      Lots: position.volume,
      "Net Profit": position.netProfit,
    })),
  };
};

const calculateDailyTradeReport = (closedPositions, summary = false) => {
  // Grouping trades by date and calculating the required fields
  const dailyReport = closedPositions.reduce((acc, trade) => {
    const date = moment(trade.openTime).tz("UTC").format("YYYY-MM-DD");

    if (!acc[date]) {
      acc[date] = {
        reportDate: date,
        tradesOpened: 0,
        openTime: 0,
        lotsTraded: 0,
        profit: 0,
      };
    }

    acc[date].tradesOpened += 1;
    acc[date].lotsTraded += trade.volume;
    acc[date].profit += trade.netProfit;

    // Calculating the open time in minutes
    if (trade.time) {
      const openTime = moment(trade.time).diff(
        moment(trade.openTime),
        "minutes",
      );
      acc[date].openTime += openTime;
    }

    return acc;
  }, {});

  // return formattedReport;
  if (summary) {
    return Object.entries(dailyReport).map(([date, report]) => ({
      date: report.reportDate,
      totalNetPl: report.profit,
      totalTrades: report.tradesOpened,
    }));
  }

  return Object.values(dailyReport).map(report => ({
    "Report Date": report.reportDate,
    "Trades Opened": report.tradesOpened,
    "Open Time": report.openTime > 0 ? `${report.openTime} min` : "0 min",
    "Lots Traded": report.lotsTraded.toFixed(2),
    Profit: `$${report.profit.toFixed(2)}`,
  }));
};

// Daily Profit and Loss Calculation
const calculateDailyProfitLoss = closedPositions => {
  // Grouping and calculating daily profit and loss
  const dailyData = closedPositions.reduce((acc, trade) => {
    const date = moment(trade.time).tz("UTC").format("YYYY-MM-DD");

    if (!acc[date]) {
      acc[date] = {
        date: date,
        profit: 0,
        loss: 0,
      };
    }

    // Accumulate profit and loss
    if (trade.netProfit >= 0) {
      acc[date].profit += trade.netProfit;
    } else {
      acc[date].loss += Math.abs(trade.netProfit);
    }

    return acc;
  }, {});

  // Formatting the data for the graph
  const formattedData = Object.values(dailyData).map(report => ({
    timestamp: report.date,
    profit: parseFloat(report.profit.toFixed(2)), // Profit
    loss: parseFloat(report.loss.toFixed(2)), // Loss
  }));

  return formattedData;
};

// Monthly Profit and Loss Calculation
const calculateMonthlyProfitLoss = closedPositions => {
  // Grouping and calculating monthly profit and loss
  const monthlyData = closedPositions.reduce((acc, trade) => {
    const month = moment(trade.time).tz("UTC").format("MMM");

    if (!acc[month]) {
      acc[month] = {
        month: month,
        profit: 0,
        loss: 0,
      };
    }

    // Accumulate profit and loss
    if (trade.netProfit >= 0) {
      acc[month].profit += trade.netProfit;
    } else {
      acc[month].loss += Math.abs(trade.netProfit);
    }

    return acc;
  }, {});

  // Formatting the data for the graph
  const formattedData = Object.values(monthlyData).map(report => ({
    timestamp: report.month,
    profit: parseFloat(report.profit.toFixed(2)), // Profit
    loss: parseFloat(report.loss.toFixed(2)), // Loss
  }));

  return formattedData;
};

const mapTradingAccountDetails = (account, details) => {
  return {
    accountId: account.accountId || null,
    login: account.login || null,
    status: account.status || null,
    currency: details.currency || null,
    balance: details.balance ? details.balance.toFixed(2) : "0.00",
    credit: details.credit ? details.credit.toFixed(2) : "0.00",
    equity: details.equity ? details.equity.toFixed(2) : "0.00",
    pnl: details.profit ? details.profit.toFixed(2) : "0.00",
    marginAvailable: details.freeMargin
      ? details.freeMargin.toFixed(2)
      : "0.00",
    marginUsed: details.margin ? details.margin.toFixed(2) : "0.00",
    createdDateTime: account.created_at || null,
    tradingDisabledReason: account.reason || null,
  };
};

//***** ************* */
// ****
// ****
//Api request Methods
// ****
// ****
////////////////////////////////

// API Controller Function for Creating Match Trade Account
const createMatchTradeAccountAPI = async (req, res) => {
  try {
    const userId = req.user._id; // Extract userId from req.user
    const result = await createMatchTradeAccount(userId);
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in createMatchTradeAccountAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function for Creating Match Trade Trading Account
const createMatchTradeTradingAccountAPI = async (req, res) => {
  try {
    const userId = req.user._id; // Extract userId from req.user
    const { planId, paymentId } = req.body;

    if (!planId || !paymentId) {
      return res
        .status(400)
        .json({ success: false, message: "planId and paymentId are required" });
    }

    const result = await createMatchTradeTradingAccount(
      userId,
      planId,
      paymentId,
    );
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in createMatchTradeTradingAccountAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function for Creating Both Account and Trading Account
const createMatchTradeAccountAndTradingAccountAPI = async (req, res) => {
  try {
    const { planId, paymentId } = req.body;
    const user = req.user;
    if (!planId || !paymentId) {
      return res
        .status(400)
        .json({ success: false, message: "planId and paymentId are required" });
    }

    const result = await createMatchTradeAccountAndTradingAccount(
      user._id,
      planId,
      paymentId,
    );
    if (result.success) {
      const plan = await PaymentPlan.findById(planId);
      if (plan) {
        if (plan.planType === "Instant-Funding") {
          try {
            const emailData = {
              to: user.email,
              templateId: "d-8ce875f3946849c28b2e115061e7f5c4",
              dynamic_template_data: {
                startingBalance: plan.accountSize,
                login: result?.data.login,
                password: user.matchTraderAccountDetails.password
              }
            }
            await sendEmail(emailData)
          } catch (error) {
            console.error("Error in sending email:", error);
            throw error;
          }
        } else {
          try {
            const emailData = {
              to: user.email,
              templateId: "d-439def4fa1d647ffa86cb8313f694533",
              dynamic_template_data: {
                firstName: user.firstName,
                startingBalance: plan.accountSize,
                login: result?.data.login,
                password: user.matchTraderAccountDetails.password
              }
            }
            await sendEmail(emailData)
          } catch (error) {
            console.error("Error in sending email:", error);
            throw error;
          }
        }
      }
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error(
      "Error in createMatchTradeAccountAndTradingAccountAPI:",
      error,
    );
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function for Getting Trading Account Details
const getTradingAccountDetailsAPI = async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "accountId is required" });
    }

    const result = await getTradingAccountDetails(accountId);
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in getTradingAccountDetailsAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getOpenPositionsAPI = async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "accountId is required" });
    }

    // Call the method to get open positions
    const result = await getOpenPositionsByAccountId(accountId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in getOpenPositionsAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function to Get Closed Positions using accountId from request params
const getClosedPositionsAPI = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { from, to } = req.query;

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "accountId is required" });
    }

    // Call the method to get closed positions
    let result;
    if (from && to) {
      result = await getClosedPositionsByAccountId(accountId, from, to);
    } else {
      result = await getClosedPositionsByAccountId(accountId);
    }

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in getClosedPositionsAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function to Get Active Orders using accountId from request params
const getActiveOrdersAPI = async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "accountId is required" });
    }

    // Call the method to get active orders
    const result = await getActiveOrdersByAccountId(accountId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in getActiveOrdersAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function to Get Ledgers using accountId and type from request params
const getLedgersAPI = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { type } = req.query;

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "accountId is required" });
    }

    if (!type) {
      return res
        .status(400)
        .json({ success: false, message: "type is required" });
    }

    // Call the method to get ledgers
    const result = await getLedgersByAccountId(accountId, type);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in getLedgersAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// API Controller Function to Change Password using userId from req.user._id or req.body.userId
const changePasswordAPI = async (req, res) => {
  try {
    // Step 1: Get userId from req.body or fallback to req.user._id
    const userId = req.body.userId || req.user._id;
    const { newPassword } = req.body;

    // Step 2: Validate inputs
    if (!newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "newPassword is required" });
    }

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }

    // Step 3: Call the method to change the password
    const result = await changePasswordByUserId(userId, newPassword);

    // Step 4: Return the result
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(result.statusCode || 500).json(result);
    }
  } catch (error) {
    console.error("Error in changePasswordAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const mapClosedPositionsToDealHistory = async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "accountId is required" });
    }

    // Call the method to get closed positions
    const result = await getClosedPositionsByAccountId(accountId);

    if (!result.data.closedPositions) {
      return res.status(400).json({
        success: false,
        message: "deal history not found",
        data: null,
      });
    }

    const mappedData = tradeHistoryResponse(result.data.closedPositions);

    return res.status(200).json({
      success: true,
      message: "deal history fetched successfully",
      data: mappedData,
    });
  } catch (error) {
    console.error("Error in getClosedPositionsAPI:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getDailyTradeReport = async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "accountId is required",
        data: null,
      });
    }

    // Fetching closed positions by accountId
    const result = await getClosedPositionsByAccountId(accountId);

    if (
      !result.data.closedPositions ||
      result.data.closedPositions.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "No trade history found for the given account",
        data: null,
      });
    }

    // Mapping data to daily trade report
    const dailyReport = calculateDailyTradeReport(result.data.closedPositions);

    // Fetch Starting Equity, Ending Equity, and Ending Balance
    for (let report of dailyReport) {
      // Convert "Report Date" to proper Date object in UTC
      const reportDateStr = report["Report Date"];
      const startDate = new Date(`${reportDateStr}T00:00:00.000Z`);
      const endDate = new Date(`${reportDateStr}T23:59:59.999Z`);

      const firstEntry = await TradingAccountBalanceReport.findOne({
        accountId,
        createdAt: { $gte: startDate, $lte: endDate },
      }).sort({ createdAt: 1 });

      const lastEntry = await TradingAccountBalanceReport.findOne({
        accountId,
        createdAt: { $gte: startDate, $lte: endDate },
      }).sort({ createdAt: -1 });

      report["Starting Equity"] = firstEntry
        ? parseFloat(firstEntry.equity)
        : null;
      report["Ending Equity"] = lastEntry ? parseFloat(lastEntry.equity) : null;
      report["Ending Balance"] = lastEntry
        ? parseFloat(lastEntry.balance)
        : null;
    }

    // Sending the response
    return res.status(200).json({
      success: true,
      message: "Daily trade report fetched successfully",
      data: dailyReport,
    });
  } catch (error) {
    console.error("Error in getDailyTradeReport:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
};

const getDailyTradeSummary = async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "accountId is required",
        data: null,
      });
    }

    // Fetching closed positions by accountId
    const result = await getClosedPositionsByAccountId(accountId);

    if (
      !result.data.closedPositions ||
      result.data.closedPositions.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "No trade history found for the given account",
        data: null,
      });
    }

    // Mapping data to daily trade report
    const dailyReport = calculateDailyTradeReport(
      result.data.closedPositions,
      true,
    );

    // Sending the response
    return res.status(200).json({
      success: true,
      message: "Daily trade summary fetched successfully",
      data: dailyReport,
    });
  } catch (error) {
    console.error("Error in getDailyTradeReport:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
};

const getProfitLossReport = async (req, res) => {
  try {
    const { accountId } = req.params;
    const { timeframe } = req.query;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "accountId is required",
        data: null,
      });
    }

    if (!["daily", "monthly"].includes(timeframe)) {
      return res.status(400).json({
        success: false,
        message: "Invalid timeframe. Allowed values are 'daily' or 'monthly'",
        data: null,
      });
    }

    // Fetching closed positions by accountId
    const result = await getClosedPositionsByAccountId(accountId);

    if (
      !result.data.closedPositions ||
      result.data.closedPositions.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "No trade history found for the given account",
        data: null,
      });
    }

    // Selecting the calculation method based on the timeframe
    const reportData =
      timeframe === "daily"
        ? calculateDailyProfitLoss(result.data.closedPositions)
        : calculateMonthlyProfitLoss(result.data.closedPositions);

    // Sending the response
    return res.status(200).json({
      success: true,
      message: `${timeframe} profit and loss report fetched successfully`,
      data: reportData,
    });
  } catch (error) {
    console.error("Error in getProfitLossReport:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
};

const getUserTradingAccounts = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { accountId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
        data: null,
      });
    }

    // Building the query object
    const query = { userId };
    if (accountId) {
      query.accountId = accountId;
    }

    // Fetching trading accounts from the database
    const accounts = await MatchTraderTradingAccount.find(query);

    if (!accounts || accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No trading accounts found for the given user",
        data: null,
      });
    }

    // Fetching details and mapping the response
    const accountDetailsPromises = accounts.map(async account => {
      try {
        const result = await getTradingAccountDetails(account.accountId);

        if (result.success && result.data) {
          return mapTradingAccountDetails(account, result.data);
        } else {
          console.error(
            `Failed to get details for accountId: ${account.accountId}`,
          );
          return null;
        }
      } catch (error) {
        console.error(
          `Error fetching details for accountId: ${account.accountId}`,
          error,
        );
        return null;
      }
    });

    const accountDetails = await Promise.all(accountDetailsPromises);

    // Filtering out null values
    const filteredDetails = accountDetails.filter(details => details !== null);

    return res.status(200).json({
      success: true,
      message: "User trading accounts fetched successfully",
      data: filteredDetails,
    });
  } catch (error) {
    console.error("Error in getUserTradingAccounts:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      data: null,
    });
  }
};

const getBalanceReportByAccountId = async (req, res) => {
  const { timeframe } = req.query || "daily";
  const { accountId } = req.params;

  // Input Validation
  if (!accountId || !timeframe) {
    return res
      .status(400)
      .json({ message: "accountId and timeframe are required." });
  }

  // Allowed timeframe values
  const allowedTimeframes = ["hourly", "daily", "monthly", "yearly"];
  if (!allowedTimeframes.includes(timeframe)) {
    return res.status(400).json({
      message: `Invalid timeframe value. Allowed values are: ${allowedTimeframes.join(", ")}.`,
    });
  }

  const matchStage = {
    $match: {
      accountId,
    },
  };

  let groupStage;
  switch (timeframe) {
    case "hourly":
      groupStage = {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
            hour: { $hour: "$createdAt" },
          },
          timestamp: { $max: "$createdAt" }, // Get the latest timestamp in each hour
          balance: { $last: { $toDouble: "$balance" } },
          equity: { $last: { $toDouble: "$equity" } },
        },
      };
      break;
    case "daily":
      groupStage = {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          timestamp: { $max: "$createdAt" }, // Get the latest timestamp in each day
          balance: { $last: { $toDouble: "$balance" } },
          equity: { $last: { $toDouble: "$equity" } },
        },
      };
      break;
    case "monthly":
      groupStage = {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          timestamp: { $max: "$createdAt" }, // Get the latest timestamp in each month
          balance: { $last: { $toDouble: "$balance" } },
          equity: { $last: { $toDouble: "$equity" } },
        },
      };
      break;
    case "yearly":
      groupStage = {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
          },
          timestamp: { $max: "$createdAt" }, // Get the latest timestamp in each year
          balance: { $last: { $toDouble: "$balance" } },
          equity: { $last: { $toDouble: "$equity" } },
        },
      };
      break;
    default:
      return res.status(400).json({ message: "Invalid timeframe value." });
  }

  const sortStage = {
    $sort: { timestamp: -1 },
  };

  const projectStage = {
    $project: {
      _id: 0,
      timestamp: 1,
      balance: 1,
      equity: 1,
    },
  };

  try {
    const reportData = await TradingAccountBalanceReport.aggregate([
      matchStage,
      groupStage,
      sortStage,
      projectStage,
    ]);

    // Check if data exists
    if (reportData.length === 0) {
      return res.status(404).json({
        message: "No data found for the given accountId and timeframe.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `${timeframe} profit and loss report fetched successfully`,
      data: reportData,
    });
  } catch (error) {
    console.error("Error fetching balance report:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

const getLeaderboard = async (req, res) => {
  try {
    const latestRecords = await TradingAccountBalanceReport.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$accountId", latestEntry: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latestEntry" } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "matchtradertradingaccounts",
          localField: "matchTraderTradingAccountId",
          foreignField: "_id",
          as: "tradingAccount",
        },
      },
      {
        $unwind: { path: "$tradingAccount", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "paymentplans",
          localField: "tradingAccount.planId",
          foreignField: "_id",
          as: "plan",
        },
      },
      { $unwind: { path: "$plan", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: { $ifNull: ["$user.firstName", ""] },
          country: { $ifNull: ["$user.country", ""] },
          profit: { $ifNull: ["$pnl", ""] },
          account_size: { $ifNull: ["$plan.accountSize", ""] },
        },
      },
    ]);

    if (!latestRecords.length) {
      return res
        .status(404)
        .json({ success: false, message: "No records found", data: [] });
    }

    // Process records to calculate percent_gain
    const leaderboard = latestRecords.map(entry => {
      const profit = parseFloat(entry.profit) || 0;
      const accountSize = parseFloat(entry.account_size) || 0;
      const percentGain =
        accountSize > 0 ? ((profit / accountSize) * 100).toFixed(2) + "%" : "";

      return {
        name: entry.name,
        country: entry.country,
        profit: `$${profit.toFixed(2)}`,
        account_size: `$${accountSize.toFixed(2)}`,
        percent_gain: percentGain,
      };
    });

    // Rank leaderboard based on profit, if same then by account size
    leaderboard.sort((a, b) => {
      const profitDiff = parseFloat(b.profit) - parseFloat(a.profit);
      if (profitDiff !== 0) {
        return profitDiff;
      }
      return parseFloat(b.account_size) - parseFloat(a.account_size);
    });

    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return res.json({
      success: true,
      message: "Leaderboad data fetched successfully",
      data: leaderboard,
    });
  } catch (error) {
    console.error("Error fetching records: ", error);
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  generateRandomPassword,
  getMatchTraderTradingAccountByAccountId,

  changePasswordByUserId,
  changePasswordAPI,

  createMatchTradeAccount,
  createMatchTradeAccountAPI,

  createMatchTradeTradingAccount,
  createMatchTradeTradingAccountAPI,

  createMatchTradeAccountAndTradingAccount,
  createMatchTradeAccountAndTradingAccountAPI,

  getTradingAccountDetails,
  getTradingAccountDetailsAPI,

  getOpenPositionsByAccountId,
  getOpenPositionsAPI,

  getClosedPositionsByAccountId,
  getClosedPositionsAPI,

  getActiveOrdersByAccountId,
  getActiveOrdersAPI,

  getLedgersByAccountId,
  getLedgersAPI,

  mapClosedPositionsToDealHistory,
  mapTradingAccountDetails,
  getDailyTradeReport,
  getProfitLossReport,
  getUserTradingAccounts,
  getBalanceReportByAccountId,
  getDailyTradeSummary,
  getLeaderboard,
};
