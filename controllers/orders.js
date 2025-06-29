const Payment = require("../models/Payment");
const CryptoCharge = require("../models/cryptoCharge");
const User = require("../models/user");
const Plan = require("../models/paymentPlans");
const mongoose = require("mongoose");
const AffiliationDetail = require("../models/affiliationDetail");
const { saveAffiliateDetails } = require("./affiliation.controller");

const getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    let userIds = [];

    if (search) {
      userIds = await User.find({
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { purchaseAmount: { $regex: search, $options: "i" } },
          { purchaseMethod: { $regex: search, $options: "i" } },
        ],
      }).distinct("_id");

      console.log(" Found User IDs:", userIds);
    }
    const allOrders = await Payment.find({});
    console.log("All Orders in DB:", allOrders.length);

    const filter = search
      ? userIds.length > 0
        ? { user: { $in: userIds } } // Change `userId` to `user`
        : { _id: null }
      : {};

    const cryptoChargeFilter = {
      ...filter,
      amount_crypto: { $gt: 0 },
    };

    const paymentFilter = {
      ...filter,
      "chargeResponse.amount": { $gt: 0 },
    };

    const [payments, cryptoCharges, totalPayments, totalCryptoCharges] =
      await Promise.all([
        Payment.find(paymentFilter).populate({
          path: "user",
          strictPopulate: false,
        }),
        CryptoCharge.find(cryptoChargeFilter).populate({
          path: "user",
          strictPopulate: false,
        }),
        Payment.countDocuments(paymentFilter),
        CryptoCharge.countDocuments(cryptoChargeFilter),
      ]);

    const combinedResults = [...payments, ...cryptoCharges].sort(
      (a, b) =>
        new Date(b.createdAt || b.created_at) -
        new Date(a.createdAt || a.created_at),
    );

    const paginatedResults = combinedResults.slice(skip, skip + limitNum);

    res.status(200).json({
      success: true,
      data: paginatedResults,
      pagination: {
        totalResults: totalPayments + totalCryptoCharges,
        currentPage: parseInt(page),
        totalPages: Math.ceil((totalPayments + totalCryptoCharges) / limitNum),
        resultsPerPage: limitNum,
      },
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Define filter configurations for different order types
const ORDER_TYPES = {
  all: {
    cryptoFilter: {},
    paymentFilter: {},
  },
  failed: {
    cryptoFilter: { status: { $ne: "paid" } },
    paymentFilter: { "chargeResponse.status": { $ne: "CAPTURED" } },
  },
  success: {
    cryptoFilter: { status: "paid" },
    paymentFilter: { "chargeResponse.status": "CAPTURED" },
  },
};

// Single controller to handle all order types
const getOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = "", orderType = "all" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Get the appropriate filters based on order type
    const filterConfig = ORDER_TYPES[orderType] || ORDER_TYPES.all;

    let userIds = [];

    if (search) {
      userIds = await User.find({
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).distinct("_id");
    }

    const baseFilter =
      search && userIds.length > 0
        ? {
            $or: [
              { userId: { $in: userIds } }, // For Payment model
              { user: { $in: userIds } }, // For CryptoCharge model
            ],
          }
        : {};

    const cryptoChargeFilter = {
      ...baseFilter,
      amount_crypto: { $gt: 0 },
      ...filterConfig.cryptoFilter,
    };

    const paymentFilter = {
      ...baseFilter,
      "chargeResponse.amount": { $gt: 0 },
      ...filterConfig.paymentFilter,
    };

    const [payments, cryptoCharges, totalPayments, totalCryptoCharges] =
      await Promise.all([
        Payment.find(paymentFilter).populate("userId"),
        CryptoCharge.find(cryptoChargeFilter).populate("user"),
        Payment.countDocuments(paymentFilter),
        CryptoCharge.countDocuments(cryptoChargeFilter),
      ]);

    const combinedResults = [...payments, ...cryptoCharges].sort(
      (a, b) =>
        new Date(b.createdAt || b.created_at) -
        new Date(a.createdAt || a.created_at),
    );

    const paginatedResults = combinedResults.slice(skip, skip + limitNum);

    res.status(200).json({
      success: true,
      data: paginatedResults,
      pagination: {
        totalResults: totalPayments + totalCryptoCharges,
        currentPage: parseInt(page),
        totalPages: Math.ceil((totalPayments + totalCryptoCharges) / limitNum),
        resultsPerPage: limitNum,
      },
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getAllOrdersForExport = async (req, res, next) => {
  try {
    const { search = "", orderType = "all" } = req.query;

    // Get the appropriate filters based on order type
    const filterConfig = ORDER_TYPES[orderType] || ORDER_TYPES.all;

    let userIds = [];

    if (search) {
      userIds = await User.find({
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).distinct("_id");
    }

    const baseFilter =
      search && userIds.length > 0
        ? {
            $or: [
              { userId: { $in: userIds } }, // For Payment model
              { user: { $in: userIds } },   // For CryptoCharge model
            ],
          }
        : {};

    const cryptoChargeFilter = {
      ...baseFilter,
      amount_crypto: { $gt: 0 },
      ...filterConfig.cryptoFilter,
    };

    const paymentFilter = {
      ...baseFilter,
      "chargeResponse.amount": { $gt: 0 },
      ...filterConfig.paymentFilter,
    };

    const [payments, cryptoCharges] = await Promise.all([
      Payment.find(paymentFilter).populate("userId"),
      CryptoCharge.find(cryptoChargeFilter).populate("user"),
    ]);

    const combinedResults = [...payments, ...cryptoCharges].sort(
      (a, b) =>
        new Date(b.createdAt || b.created_at) -
        new Date(a.createdAt || a.created_at),
    );

    res.status(200).json({
      success: true,
      data: combinedResults,
      totalResults: combinedResults.length,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


const getSingleOrder = async (req, res, next) => {
  try {
    const { orderId, method } = req.query;
    console.log("----------------------------------");
    console.log("ORDER ID: ", orderId);
    console.log("----------------------------------");
    let order, user;
    let userId;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid MT5 Account ID format" });
    }
    const objectId = new mongoose.Types.ObjectId(orderId);

    if (method === "Card") {
      const payment = await Payment.findById(orderId).populate({
        path: "userId",
        populate: {
          path: "affiliateDetails.affiliateUserId",
        },
      });

      if (payment.chargeResponse?.metadata?.planId) {
        const plan = await Plan.findById(
          payment.chargeResponse.metadata.planId,
        );
        order = {
          ...payment.toObject(),
          plan: plan || null,
        };
      } else {
        order = payment;
      }
      if (!order)
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      userId = order.userId._id;
    } else if (method === "Crypto") {
      order = await CryptoCharge.findById(orderId)
        .populate({
          path: "user",
          populate: {
            path: "affiliateDetails.affiliateUserId",
          },
        })
        .populate("paymentPlan");
      if (!order)
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      userId = order.user._id;
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }

    user = order.userId;

    const totalCardOrders = await Payment.countDocuments({
      userId,
      "chargeResponse.status": "CAPTURED",
    });
    const totalCryptoOrders = await CryptoCharge.countDocuments({
      userId,
      status: "paid",
    });
    const totalOrders = totalCardOrders + totalCryptoOrders;

    const totalCardSpending = await Payment.aggregate([
      { $match: { userId, "chargeResponse.status": "CAPTURED" } },
      { $group: { _id: null, total: { $sum: "$chargeResponse.amount" } } },
    ]);

    const totalCryptoSpending = await CryptoCharge.aggregate([
      { $match: { userId, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount_crypto" } } },
    ]);

    const totalSpending =
      (totalCardSpending.length ? totalCardSpending[0].total : 0) +
      (totalCryptoSpending.length ? totalCryptoSpending[0].total : 0);

    res.status(200).json({
      success: true,
      data: {
        order,
        user,
        totalOrders,
        totalSpending,
      },
    });
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = { getAllOrders, getSingleOrder, getOrders, getAllOrdersForExport };
