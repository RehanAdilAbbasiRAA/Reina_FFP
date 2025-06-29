const axios = require("axios");
const Payment = require("../models/Payment");
const User = require("../models/user");
const Plan = require("../models/paymentPlans");
const Discount = require("../models/Discount");
const mongoose = require("mongoose");
const TradeLockerAccount = require("../models/TradelockerCredentials");
const MatchTraderTradingAccount = require("../models/matchTraderTraddingAccount");

const {
  createMatchTradeAccountAndTradingAccount,
  resetTradingAccount,
} = require("./matchTraderController");
const {
  handleMT5AccountCreation,
  handleTradeLockerAccountCreation,
  handleTradeLockerTradingAccountCreation,
  upgradeMT5Account,
} = require("./mt5");
const { processAffiliateCommissionLogic } = require("./affiliation.controller");
const moment = require("moment");
const generateRandomPassword = require("../utils/generateRandomPassword");
// const logCronJob = require("../utils/systemLogger");
const paymaxis = require('@api/paymaxis');

// Initialize Paymaxis API key once
const PAYMAXIS_API_KEY = process.env.PAYMAXIS_API_KEY;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL;
const WEBHOOK_URL = `${process.env.NGROK_URL}/tap-payments/tap-webhook`;

paymaxis.auth(PAYMAXIS_API_KEY);

/**
 * Webhook to handle Paymaxis payment events
 */
const webhook = async (req, res) => {
  console.log('Paymaxis Webhook received');
  try {
    const event = req.body;
    console.log('Webhook event payload:', event);

    const { state, id: paymentId, metadata = {}, customer = {}, paymentMethodDetails } = event;

    // Only process completed payments
    if (state !== 'COMPLETED') {
      return res.status(200).json({ message: `No action for state: ${state}` });
    }

    const { userId = customer.referenceId, accountType, planId } = metadata;
    if (!userId || !accountType || !planId) {
      return res.status(400).json({ error: 'Missing metadata fields' });
    }

    // Fetch user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update customer payment method on user
    if (paymentMethodDetails) {
      user.paymentMethodId = paymentMethodDetails.cardToken;
      user.customerId = customer.referenceId;
      user.cardDetails = {
        last4: paymentMethodDetails.customerAccountNumber.slice(-4),
        brand: paymentMethodDetails.cardBrand,
        expiryMonth: paymentMethodDetails.cardExpiryMonth,
        expiryYear: paymentMethodDetails.cardExpiryYear
      };
    }

    // Upsert payment record
    const paymentRecord = await Payment.findOneAndUpdate(
      { 'chargeResponse.id': paymentId },
      {
        userId,
        type: accountType,
        chargeResponse: event,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Link payment to user
    if (!user.payment) user.payment = [];
    if (!user.payment.includes(paymentRecord._id)) {
      user.payment.push(paymentRecord._id);
    }
    await user.save();

    // Account creation workflows
    let accountResponse;
    switch (accountType) {
      case 'mt5':
        accountResponse = await handleMT5AccountCreation(userId, planId);
        break;
      case 'mt5-upgrade':
        accountResponse = await upgradeMT5Account(customer.login);
        break;
      case 'matchTrader':
        accountResponse = await createMatchTradeAccountAndTradingAccount(userId, planId, paymentRecord._id);
        // send emails if needed...
        break;
      case 'tradeLocker':
        // implement tradeLocker logic...
        break;
      default:
        return res.status(400).json({ error: `Unknown accountType: ${accountType}` });
    }

    // Process commissions
    await processAffiliateCommissionLogic({ userId, planId });

    return res.status(200).json({ message: 'Webhook processed' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

/**
 * Create a new Paymaxis payment and record in DB
 */
const createNewCharge = async (req, res) => {
  console.log('createNewCharge invoked');
  try {
    const { planId, login, price, metadata = {}, couponCode } = req.body;
    const userId = req.user?._id || req.body.userId;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User not authenticated' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Validate plan
    if (!planId) {
      return res.status(400).json({ success: false, error: 'planId is required' });
    }
    const plan = await Plan.findById(planId);
    if (!plan && !login) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    // Calculate final amount
    let amount = price;
    metadata.userId = userId;
    metadata.planId = planId;
    metadata.accountType = plan.tradingPlatform;

    // Coupon handling...
    const coupon = couponCode && await Discount.findOne({ couponCode });
    if (coupon && coupon.percentageOff === 100) {
      // free case: trigger webhook directly
      const freeEvent = {
        state: 'COMPLETED',
        id: `free_${Date.now()}`,
        metadata,
        customer: { referenceId: userId, login }
      };
      await paymaxisWebhook({ body: freeEvent }, { status: () => ({ json: () => ({}) }) });
      return res.json({ success: true, freeAccess: true });
    }

    // Prepare Paymaxis payment payload
    const paymentPayload = {
      paymentType: 'DEPOSIT',
      amount: Number(amount).toFixed(2),
      currency: 'USD',
      description: plan.name,
      customer: {
        referenceId: userId,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: "12345 67890" || 'N/A'
      },
      metadata,
      returnUrl: `${FRONTEND_BASE_URL}/payment-status`,
      webhookUrl: WEBHOOK_URL
    };

    // If card details passed in req.body, include them
    if (req.body.card) paymentPayload.card = req.body.card;

    // Call Paymaxis createPayment API
    const { data } = await paymaxis.createPayment(paymentPayload);
    const result = data.result;

    // Persist payment record
    const newPayment = new Payment({
      userId,
      platform: metadata.accountType,
      priceOfPlan: plan.price,
      priceAfterDiscount: amount,
      couponCodeUsed: couponCode,
      isUpgradation: Boolean(login),
      chargeResponse: result
    });
    await newPayment.save();
    user.payment.push(newPayment._id);
    await user.save();

    return res.json({ success: true, checkOutUrl: result.redirectUrl, paymentId: result.id });

  } catch (err) {
    console.error('createNewCharge error:', err.response || err);
    const errorMsg = err.response?.data || err.message;
    return res.status(500).json({ success: false, error: err });
  }
};



const chargeDetail = async (req, res) => {
  console.log("chargeDetail: ");
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 1;
    const email = req.query.email;

    const skip = (page - 1) * limit;

    // Step 1: Fetch payment records from MongoDB
    let payments = await Payment.find().skip(skip).limit(limit).populate({
      path: "userId",
      select: "firstName lastName email", // Select fields to populate
    });

    // Step 2: Filter by email if the email parameter is provided
    if (email) {
      payments = payments.filter(
        payment =>
          payment.userId && new RegExp(email, "i").test(payment.userId.email),
      );
    }

    // Fetch the total number of payments (not filtered by email)
    const totalPayments = await Payment.countDocuments();

    // Calculate the total number of pages (not filtered by email)
    const totalPages = Math.ceil(totalPayments / limit);

    res.status(200).json({
      success: true,
      message: "Payments retrieved successfully",
      data: payments,
      pagination: {
        totalPayments: payments.length, // Reflect the filtered count
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payments",
      error: error.response ? error.response.data : error.message,
    });
  }
};

const getCharge = async (req, res) => {
  try {
    const { id } = req.query;

    const apiKey = `Bearer ${process.env.TAP_API_SK}`;

    const url = `https://api.tap.company/v2/charges/${id}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: apiKey,
        accept: "application/json",
      },
    });

    res.status(200).json({
      success: true,
      message: "Charge details retrieved successfully",
      data: response.data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to retrieve charge details",
      error: error.response ? error.response.data : error.message,
    });
  }
};

const getCustomerCardDetails = async (req, res) => {
  const apiKey = `Bearer ${process.env.TAP_API_SK}`;
  const baseUrl = "https://api.tap.company/v2/card";

  try {
    // Get customerId from req.user
    const customerId = req.query.customerId || req.user._id;

    if (!customerId) {
      return res.status(400).json({ message: "Customer ID is required." });
    }

    // Build the full URL
    const url = `${baseUrl}/${customerId}`;

    // Make the GET request to the Tap API
    const response = await axios.get(url, {
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
      },
    });

    // Respond with the data from Tap API
    res.status(200).json({ cards: response.data.data });
  } catch (error) {
    console.error("Error fetching customer card details:", error);

    // Handle error responses from the Tap API
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ message: error.response.data || "Error from Tap API" });
    }

    // Handle other errors
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

// Verify Paymaxis webhook signature for security
const verifyWebhookSignature = (req, res, next) => {
  try {
    const signature = req.headers['paymaxis-signature'];
    const payload = JSON.stringify(req.body);
    const secret = process.env.PAYMAXIS_WEBHOOK_SECRET;

    if (!signature) {
      return res.status(400).json({ error: 'Missing signature header' });
    }

    // In a real implementation, you would validate the signature here
    // This is a simplified example - implement actual signature verification based on Paymaxis docs
    const isValid = true; // Replace with actual validation

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return res.status(400).json({ error: 'Invalid signature' });
  }
};

const createResetCharge = async (req, res) => {
  console.log("createResetCharge: Api ");
  try {
    const { accountId } = req.body;
    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, error: "Account ID is required" });
    }

    const account = await MatchTraderTradingAccount.findOne({ accountId });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Check lastResetDate gap
    const lastResetDate = account.lastResetDate;
    if (lastResetDate) {
      const today = new Date();
      const diffTime = today - lastResetDate; // milliseconds
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // convert to days

      const remainingDays = 7 - diffDays;

      if (remainingDays > 0) {
        return res.status(400).json({
          success: false,
          message: `You need to wait ${remainingDays} more day(s) to apply for a new reset.`,
        });
      }
    }

    const planId = account.planId;

    if (!planId || !mongoose.Types.ObjectId.isValid(planId)) {
      return res
        .status(400)
        .json({ success: false, error: "planId not found" });
    }

    const userId = account.userId;
    const user = await User.findById(userId);
    if (!userId || !user) {
      return res.status(400).json({ success: false, error: "user not found" });
    }

    const { metadata = {} } = req.body; //optional metadata
    let { sourceId } = req.body;

    if (!sourceId) {
      sourceId = "src_card";
    }

    if (!user.payment) {
      user.payment = [];
    }

    metadata.userId = userId;
    metadata.accountId = accountId;

    // Only try to find the plan if the ID format is valid
    let plan = await Plan.findById(planId);

    if (!plan) {
      return res.status(404).json({ success: false, error: "Plan not found" });
    }

    let amount = plan.price * 0.1;

    if (!amount && amount !== 0) {
      return res
        .status(400)
        .json({ success: false, error: "Plan amount must be specified" });
    }

    metadata.accountType = plan.tradingPlatform;

    const apiKey = `Bearer ${process.env.TAP_API_SK}`;
    const url = "https://api.tap.company/v2/charges";
    const webhookUrl = `${process.env.NGROK_URL}/api/tap-payments/reset-account-webhook`;
    const redirectUrl = `${process.env.FRONTEND_BASE_URL}/payment-status`;

    const chargeData = {
      amount,
      currency: "USD",
      threeDSecure: true,
      description: "reset account payment",
      metadata,
      customer: {
        first_name: user.firstName,
        last_name: user.lastName,
        email: user.email,
      },
      source: {
        id: sourceId,
      },
      redirect: {
        url: redirectUrl,
      },
      post: {
        url: webhookUrl,
      },
    };

    // Create the charge via Tap API
    const response = await axios.post(url, chargeData, {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
    });

    let newPaymentData = {
      userId,
      platform: plan.tradingPlatform,
      priceOfPlan: amount,
      priceAfterDiscount: amount,
      couponCodeUsed: "No discount taken",
      description: "Account reset payment",
      chargeResponse: response.data,
    };

    // Create and save the payment
    const newPayment = new Payment(newPaymentData);
    await newPayment.save();

    user.payment.push(newPayment._id);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Charge created successfully",
      checkOutUrl: response.data.transaction.url,
      data: response.data,
    });
  } catch (error) {
    console.error("Failed to create charge:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create charge",
      error: error.response ? error.response.data : error.message,
    });
  }
};

const resetAccountWebhook = async (req, res) => {
  console.log("resetAccountWebhook: api hit");
  try {
    const event = req.body;
    const { status, id: chargeId, customer, metadata } = event;
    const { payment_agreement } = event;

    // Handle successful payments
    if (status === "CAPTURED") {
      // Extract userId and accountType from metadata with fallbacks
      const userId = metadata?.userId || customer?.id || req.body.userId;
      const accountType = metadata?.accountType || req.body.accountType;
      const accountId = metadata?.accountId || req.body.accountId;

      // Validate required parameters
      if (!userId) {
        console.error("User ID not found in webhook payload");
        return res.status(400).json({ error: "User ID not found" });
      }
      if (!accountType) {
        console.error("Account type not specified in webhook payload");
        return res.status(400).json({ error: "Account type not specified" });
      }
      if (!accountId) {
        console.error("Account ID not specified in webhook payload");
        return res.status(400).json({ error: "Account ID not specified" });
      }

      // Find user and validate
      const user = await User.findById(userId);
      if (!user) {
        console.error(`User with ID ${userId} not found`);
        return res.status(404).json({ error: "User not found" });
      }

      // Process payment agreement if available
      if (payment_agreement) {
        user.payment_agreementId = payment_agreement.id;
        user.cardId = payment_agreement.contract.id;
        user.customerId = payment_agreement.contract.customer_id;
      }

      // Initialize payment array if doesn't exist
      if (!user.payment) {
        user.payment = [];
      }

      // Create or update payment record
      const payment = await Payment.findOneAndUpdate(
        { "chargeResponse.id": event.id },
        {
          $set: {
            userId,
            type: accountType,
            chargeResponse: event,
            updatedAt: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      // Add payment to user if not already added
      if (!user.payment.includes(payment._id)) {
        user.payment.push(payment._id);
      }

      // Save user changes
      await user.save();

      switch (accountType) {
        case "matchTrader":
          try {
            const result = await resetTradingAccount(accountId);
          } catch (error) {
            console.error("Error in match trader account reset: ", error);
          }
          break;
        default:
          console.error(`Unknown account type: ${accountType}`);
          return res.status(400).json({
            error: `Unknown account type: ${accountType}`,
          });
      }
    } else {
      console.log(
        `Webhook received for event status: ${status || "undefined"}, no action taken.`,
      );
      return res
        .status(400)
        .json({ message: "Payment status is not captured" });
    }

    console.log("Reset Account Webhook processed successfully");
    return res
      .status(200)
      .json({ message: "Reset Account Webhook processed successfully" });
  } catch (error) {
    console.error("Failed to process Reset Account Webhook:", error.message);
    console.debug("Full error details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getCharge,
  chargeDetail,
  webhook,
  createNewCharge,
  getCustomerCardDetails,
  resetAccountWebhook,
  createResetCharge,
  verifyWebhookSignature
};
