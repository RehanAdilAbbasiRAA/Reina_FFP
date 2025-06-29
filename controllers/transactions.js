const Payment = require("../models/Payment");

exports.getAllTransactions = async (req, res) => {
  try {
    const { search, status } = req.query;

    const query = {};

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { transactionId: { $regex: search, $options: "i" } },
        { account: { $regex: search, $options: "i" } },
        { "cardDetails.last4": { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const transactions = await Payment.find(query)
      .sort({ created_at: -1 })
      .lean();

    res.json({
      success: true,
      data: transactions,
    });
  } catch (error) {
    console.error("Error in getAllTransactions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getTransactionById = async (req, res) => {
  try {
    const transaction = await Payment.findById(req.params.id).populate({
      path: "paymentPlan",
      model: "PaymentPlan",
      select: "planType accountSize price originalPrice fundingOptions",
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const response = {
      success: true,
      transaction: {
        ...transaction._doc,
        accountSize: transaction.paymentPlan?.accountSize,
        planType: transaction.paymentPlan?.planType,
        fundingOptions: transaction.paymentPlan?.fundingOptions,
      },
    };

    res.json(response);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};
