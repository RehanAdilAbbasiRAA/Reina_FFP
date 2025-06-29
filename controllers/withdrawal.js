const Withdrawal = require("../models/Withdrawal");
const PayoutDetail = require("../models/payoutDetail");
const mt5_credential = require("../models/MT5Credentials");
const User = require("../models/user");
const AWS = require("aws-sdk");
const s3 = new AWS.S3();

const createWithdrawalRequest = async (req, res) => {
  try {
    const {
      withdrawalAmount,
      cryptoWallet,
      isAffiliateWithdrawal,
      tradingAccountID,
      networkAddress,
    } = req.body;
    const userID = req.user._id;
    const user = await User.findById(userID);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.payoutsEnabled) {
      return res.status(403).json({
        success: false,
        message: "Payouts are currently disabled for your account",
      });
    }

    const selectedField = isAffiliateWithdrawal
      ? "lastAffiliateWithdrawlReq"
      : "lastTradingProfitWithdrawlReq";

    if (selectedField === "lastTradingProfitWithdrawlReq") {
      const selectUser = await mt5_credential
        .find({
          user_id: userID,
          group: "demo\\comp\\demoKBComp-SLF2",
        })
        .sort({ creation_date: 1 })
        .limit(1);
      const isUserFunded = selectUser.length > 0 ? selectUser[0] : null;

      if (!isUserFunded || !isUserFunded.phase_1_complete) {
        return res.status(403).json({
          success: false,
          message: "You are not eligible for withdrawal",
        });
      }

      const fundedDate = new Date(isUserFunded.creation_date);
      const currentDateFunded = new Date();
      const daysFunded = Math.floor(
        (currentDateFunded - fundedDate) / (1000 * 3600 * 24),
      );

      if (daysFunded < 14) {
        const nextEligibleDateFunded = new Date(fundedDate);
        nextEligibleDateFunded.setDate(nextEligibleDateFunded.getDate() + 14);
        return res.status(403).json({
          success: false,
          message: `You cannot withdraw now. Try after ${nextEligibleDateFunded.toISOString().split("T")[0]}.`,
        });
      }
    }

    const lastWithdrawalDate = user[selectedField];
    if (lastWithdrawalDate) {
      const lastRequestDate = new Date(lastWithdrawalDate);
      const daysDiff = Math.floor(
        (new Date() - lastRequestDate) / (1000 * 3600 * 24),
      );

      if (daysDiff < 14) {
        const nextEligibleDate = new Date(lastRequestDate);
        nextEligibleDate.setDate(nextEligibleDate.getDate() + 14);
        return res.status(403).json({
          success: false,
          message: `Try again after ${nextEligibleDate.toISOString().split("T")[0]}.`,
        });
      }
    }

    if (!withdrawalAmount || !cryptoWallet) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal amount and crypto wallet are required.",
      });
    }

    const withdrawalRequest = new Withdrawal({
      user: userID,
      tradingAccountID,
      networkAddress,
      withdrawalAmount,
      cryptoWallet,
      isAffiliateWithdrawal: isAffiliateWithdrawal || false,
    });

    const savedWithdrawal = await withdrawalRequest.save();

    let mt5AccountUpdate = null;
    if (tradingAccountID) {
      const updatedAccount = await mt5_credential.findOneAndUpdate(
        { login: tradingAccountID },
        {
          hasSubmittedPayoutRequest: true,
          $inc: { payoutRequestCount: 1 },
        },
        { new: true },
      );

      if (updatedAccount) {
        mt5AccountUpdate = {
          login: updatedAccount.login,
          hasSubmittedPayoutRequest: updatedAccount.hasSubmittedPayoutRequest,
          payoutRequestCount: updatedAccount.payoutRequestCount,
        };
      }
    }

    await User.findByIdAndUpdate(userID, {
      [selectedField]: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Withdrawal request created successfully",
      withdrawalRequest: savedWithdrawal,
      mt5Account: mt5AccountUpdate,
    });
  } catch (error) {
    console.error("Withdrawal creation error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const managerPayoutRequest = async (req, res) => {
  try {
    const { withdrawalAmount, cryptoWallet, user } = req.body;

    const withdrawalRequest = new Withdrawal({
      user,
      withdrawalAmount,
      cryptoWallet,
    });

    const savedWithdrawal = await withdrawalRequest.save();

    return res.status(200).json({
      success: true,
      message: "Withdrawal Manager Request Created",
      withdrawalRequest: savedWithdrawal,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the withdrawal request",
      error: error.message,
    });
  }
};

const getWithdrawalRequests = async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user._id });

    return res.status(200).json({
      success: true,
      withdrawals,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the withdrawal requests",
      error: error.message,
    });
  }
};

// add param for isAffiliate
const getAllWithdrawals = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const filter = req.query.isAffiliateWithdrawal;

    const query = {};

    if (filter === "true") {
      query.isAffiliateWithdrawal = true;
    } else if (filter === "false") {
      query.isAffiliateWithdrawal = false;
    }

    const withdrawals = await Withdrawal.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "user",
        select: "_id firstName lastName",
      });

    // Count total documents matching the query
    const totalWithdrawals = await Withdrawal.countDocuments(query);

    return res.status(200).json({
      success: true,
      withdrawals,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalWithdrawals / limit),
        totalWithdrawals,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the withdrawal requests",
      error: error.message,
    });
  }
};
const getAllWithdrawalRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    let withdrawals;

    if (req.query.isTrading) {
      withdrawals = await Withdrawal.find({
        $or: [
          { isAffiliateWithdrawal: { $exists: false } },
          { isAffiliateWithdrawal: false },
        ],
        tradingAccountID: { $exists: true },
      })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "user",
          select: "_id firstName lastName",
        });
    } else {
      withdrawals = await Withdrawal.find()
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "user",
          select: "_id firstName lastName",
        });
    }

    const totalWithdrawals = await Withdrawal.countDocuments();

    return res.status(200).json({
      success: true,
      withdrawals,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalWithdrawals / limit),
        totalWithdrawals,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the withdrawal requests",
      error: error.message,
    });
  }
};

const getAllWithdrawalRequestsOfUser = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;
    const tradingAccountID = req.query.tID;

    let userID = req.user._id;
    console.log("REQ QUERY", req.query.aw);

    let withdrawals;

    if (req.query.aw === "true") {
      console.log("AFFFFFFFFFFFFFFFFFFF");

      withdrawals = await Withdrawal.find({
        user: userID,
        isAffiliateWithdrawal: true,
      })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "user",
          select: "_id firstName lastName",
        });

      console.log("WITHDRAWLS", withdrawals);
    } else {
      withdrawals = await Withdrawal.find({
        user: userID,
        tradingAccountID: tradingAccountID,
        $or: [
          { isAffiliateWithdrawal: false },
          { isAffiliateWithdrawal: { $exists: false } },
        ],
      })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "user",
          select: "_id firstName lastName",
        });
    }

    // const withdrawals = await Withdrawal.find({
    //   user: userID,
    //   tradingAccountID: tradingAccountID,
    //   $or: [
    //     { isAffiliateWithdrawal: false },
    //     { isAffiliateWithdrawal: { $exists: false } }
    //   ]
    // })
    //   .sort({ created_at: -1 })
    //   .skip(skip)
    //   .limit(limit)
    //   .populate({
    //     path: "user",
    //     select: "_id firstName lastName",
    //   });

    const totalWithdrawals = await Withdrawal.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Successfully fetched Withdrawl Requests",
      withdrawals,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalWithdrawals / limit),
        totalWithdrawals,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the withdrawal requests",
      error: error.message,
    });
  }
};

const getAllWithdrawalRequestsOfAccount = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;
    const tradingAccountID = req.query.tID;

    const withdrawals = await Withdrawal.find({
      tradingAccountID: tradingAccountID,
      $or: [
        { isAffiliateWithdrawal: false },
        { isAffiliateWithdrawal: { $exists: false } },
      ],
    })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "user",
        select: "_id firstName lastName",
      });

    const totalWithdrawals = await Withdrawal.countDocuments({
      tradingAccountID: tradingAccountID,
      $or: [
        { isAffiliateWithdrawal: false },
        { isAffiliateWithdrawal: { $exists: false } },
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Successfully fetched Withdrawl Requests",
      withdrawals,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalWithdrawals / limit),
        totalWithdrawals,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching the withdrawal requests",
      error: error.message,
    });
  }
};

const updateWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedWithdrawal = await Withdrawal.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { status },
      { new: true },
    );

    if (!updatedWithdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal Request not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Withdrawal Request Updated",
      withdrawalRequest: updatedWithdrawal,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the withdrawal request",
      error: error.message,
    });
  }
};

const deleteWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedWithdrawal = await Withdrawal.findOneAndDelete({
      _id: id,
      user: req.user._id,
    });

    if (!deletedWithdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal Request not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Withdrawal Request Deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while deleting the withdrawal request",
      error: error.message,
    });
  }
};

const approveWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedWithdrawal = await Withdrawal.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { status: "approved" },
      { new: true },
    );

    if (!updatedWithdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal Request not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Withdrawal Request Approved",
      withdrawalRequest: updatedWithdrawal,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the withdrawal request",
      error: error.message,
    });
  }
};

const rejectWithdrawalRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedWithdrawal = await Withdrawal.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { status: "rejected" },
      { new: true },
    );

    if (!updatedWithdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal Request not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Withdrawal Request Rejected",
      withdrawalRequest: updatedWithdrawal,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the withdrawal request",
      error: error.message,
    });
  }
};

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const documentInfo = {
      fileName: req.file.originalname,
      fileUrl: req.file.location,
      fileKey: req.file.key,
    };

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $push: { documents: documentInfo },
      },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Document uploaded successfully",
      document: documentInfo,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while uploading the document",
      error: error.message,
    });
  }
};

const getOriginalDocument = async (req, res) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: "trading-agreement/_Vitual_Funded_Trader_Agreement.pdf",
    Expires: 3600,
  };

  const url = s3.getSignedUrl("getObject", params);

  return res.status(200).json({
    success: true,
    url: url,
  });
};

const getDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    const user = await User.findById(req.user._id);
    const document = user.documents.find(
      doc => doc._id.toString() === documentId,
    );

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: document.fileKey,
      Expires: 3600,
    };

    const url = s3.getSignedUrl("getObject", params);

    return res.status(200).json({
      success: true,
      url: url,
    });
  } catch (error) {
    console.error("Error generating pre-signed URL:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while generating the pre-signed URL",
      error: error.message,
    });
  }
};

const getDocumentAdmin = async (req, res) => {
  try {
    const { userId, documentId } = req.params;

    const user = await User.findById(userId);
    const document = user.documents.find(
      doc => doc._id.toString() === documentId,
    );

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: document.fileKey,
      Expires: 3600,
    };

    const url = s3.getSignedUrl("getObject", params);

    return res.status(200).json({
      success: true,
      url: url,
    });
  } catch (error) {
    console.error("Error generating pre-signed URL:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while generating the pre-signed URL",
      error: error.message,
    });
  }
};

const rejectDocumentRequest = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.documents.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No documents found for this user",
      });
    }

    const deletePromises = user.documents.map(doc => {
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: doc.fileKey,
      };
      return s3.deleteObject(params).promise();
    });

    await Promise.all(deletePromises);

    user.documents = [];
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Request Rejected",
    });
  } catch (error) {
    console.error("Error Rejecting document:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while Rejecting document",
      error: error.message,
    });
  }
};

const approveDocumentRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedUser = await User.findOneAndUpdate(
      { _id: id },
      { isSignatureApproved: true },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "Requested user not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Request Accepted",
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the user request",
      error: error.message,
    });
  }
};

const isUserDocumentApproved = async (req, res) => {
  const user = await User.findOne({
    _id: req.user._id,
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (!user.isSignatureApproved) {
    return res.status(200).json({
      success: false,
      message: "User not approved for Withdrawal",
    });
  }

  return res.status(200).json({
    success: true,
    message: "User approved for Withdrawal",
  });
};

const unsignedDocumentUsers = async (req, res) => {
  const users = await User.find({
    isSignatureApproved: false,
    "documents.1": { $exists: true },
  });

  res.status(200).json(users);
};

const getAllDocumentsRaw = async (req, res) => {
  try {
    const { search = "", isSignatureApproved } = req.query;

    const query = { documents: { $exists: true, $ne: [] } };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    if (isSignatureApproved === "true") {
      query.isSignatureApproved = true;
    } else if (isSignatureApproved === "false") {
      query.isSignatureApproved = false;
    }

    const dbUsers = await User.find(query);

    return res.status(200).json({
      success: true,
      data: dbUsers,
    });
  } catch (error) {
    console.error("Error fetching documents:", error);
    return res
      .status(500)
      .json({ success: false, message: "internal server error" });
  }
};

const getAllDocuments = async (req, res) => {
  try {
    const {
      limit = 10,
      page = 1,
      search = "",
      isSignatureApproved,
    } = req.query;

    const query = { documents: { $exists: true, $ne: [] } };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    if (isSignatureApproved === "true") {
      query.isSignatureApproved = true;
    } else if (isSignatureApproved === "false") {
      query.isSignatureApproved = false;
    }

    const dbUsers = await User.find(query)
      .select("documents firstName lastName email isSignatureApproved")
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const totalDocuments = await User.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: dbUsers,
      totalDocuments,
      totalPages: Math.ceil(totalDocuments / limit),
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching documents:", error);
    return res
      .status(500)
      .json({ success: false, message: "internal server error" });
  }
};

const getWithdrawalRequestsManager = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      isAffiliate = "false",
      search = "",
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let matchQuery = { status };

    if (isAffiliate == "true") {
      matchQuery.isAffiliatePayout = true;
    } else {
      matchQuery.isAffiliatePayout = false;
    }

    let userMatch = {};
    if (search.trim()) {
      userMatch = {
        $or: [
          { "userId.firstName": { $regex: search, $options: "i" } },
          { "userId.lastName": { $regex: search, $options: "i" } },
          { "userId.email": { $regex: search, $options: "i" } },
        ],
      };
    }

    const withdrawalsPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
        },
      },
      { $unwind: "$userId" },
      { $match: userMatch },
      {
        $facet: {
          metadata: [{ $count: "totalWithdrawals" }],
          data: [{ $skip: skip }, { $limit: parseInt(limit) }],
        },
      },
    ];

    const result = await PayoutDetail.aggregate(withdrawalsPipeline);

    const withdrawals = result[0].data;
    const totalWithdrawals =
      result[0].metadata.length > 0
        ? result[0].metadata[0].totalWithdrawals
        : 0;

    res.status(200).json({
      success: true,
      data: withdrawals,
      pagination: {
        totalWithdrawals,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalWithdrawals / parseInt(limit)),
        resultsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getWithdrawalRequestsManagerForExport = async (req, res) => {
  try {
    const { status, isAffiliate = "false", search = "" } = req.query;

    let matchQuery = { status };

    matchQuery.isAffiliatePayout = isAffiliate === "true";

    let userMatch = {};
    if (search.trim()) {
      userMatch = {
        $or: [
          { "userId.firstName": { $regex: search, $options: "i" } },
          { "userId.lastName": { $regex: search, $options: "i" } },
          { "userId.email": { $regex: search, $options: "i" } },
        ],
      };
    }

    const withdrawalsPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
        },
      },
      { $unwind: "$userId" },
      { $match: userMatch },
    ];

    const withdrawals = await PayoutDetail.aggregate(withdrawalsPipeline);

    res.status(200).json({
      success: true,
      data: withdrawals,
      totalResults: withdrawals.length,
    });
  } catch (error) {
    console.error("Error fetching withdrawals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const enablePayoutsForAllClients = async (req, res) => {
  try {
    await User.updateMany({}, { $set: { payoutsEnabled: true } });

    return res.status(200).json({
      success: true,
      message: "Payouts enabled for all clients",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while enabling payouts for all clients",
      error: error.message,
    });
  }
};

const disablePayoutsForAllClients = async (req, res) => {
  try {
    await User.updateMany({}, { $set: { payoutsEnabled: false } });

    return res.status(200).json({
      success: true,
      message: "Payouts disabled for all clients",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while disabling payouts for all clients",
      error: error.message,
    });
  }
};

const updatePayoutStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { payoutsEnabled } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { payoutsEnabled } },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Payouts ${payoutsEnabled ? "enabled" : "disabled"} for client`,
      user: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating payout status",
      error: error.message,
    });
  }
};

module.exports = {
  createWithdrawalRequest,
  managerPayoutRequest,
  getWithdrawalRequests,
  getAllWithdrawalRequests,
  getAllWithdrawals,
  updateWithdrawalRequest,
  deleteWithdrawalRequest,
  getAllWithdrawalRequestsOfUser,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  uploadDocument,
  getDocument,
  approveDocumentRequest,
  isUserDocumentApproved,
  getOriginalDocument,
  unsignedDocumentUsers,
  getAllDocuments,
  getAllDocumentsRaw,
  getDocumentAdmin,
  getAllWithdrawalRequestsOfAccount,
  rejectDocumentRequest,
  getWithdrawalRequestsManager,
  enablePayoutsForAllClients,
  disablePayoutsForAllClients,
  updatePayoutStatus,
  getWithdrawalRequestsManagerForExport,
};
