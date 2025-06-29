const Kyc = require("../models/kyc");
const User = require("../models/user");
const mongoose = require("mongoose");

const uploadController = async (req, res) => {
  // Validate authentication
  if (!req.user || !req.user._id) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
      message: "User authentication failed",
    });
  }

  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded",
        message:
          "Both document and selfie files are required for KYC verification",
        expectedFields: ["documentFile", "selfieFile"],
      });
    }

    const expectedFields = ["documentFile", "selfieFile"];
    const missingFields = expectedFields.filter(
      field =>
        !req.files[field] ||
        !Array.isArray(req.files[field]) ||
        req.files[field].length === 0,
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required files",
        message: `The following files are required: ${missingFields.join(", ")}`,
        missingFields,
        expectedFields,
      });
    }

    const documentFile = req.files.documentFile[0];
    const selfieFile = req.files.selfieFile[0];

    const fileValidationErrors = [];

    if (!documentFile.location || !documentFile.key) {
      fileValidationErrors.push(
        "Document file missing required properties (location, key)",
      );
    }
    if (!selfieFile.location || !selfieFile.key) {
      fileValidationErrors.push(
        "Selfie file missing required properties (location, key)",
      );
    }

    if (fileValidationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "File validation failed",
        message: "Uploaded files are missing required properties",
        details: fileValidationErrors,
      });
    }

    const existingKyc = await Kyc.findOne({ userId: req.user._id });
    if (existingKyc) {
      return res.status(409).json({
        success: false,
        error: "KYC already exists",
        message: "User has already submitted KYC documents",
        currentStatus: existingKyc.status,
        submittedAt: existingKyc.createdAt,
      });
    }

    const uploadedFiles = {
      documentFile: {
        url: documentFile.location,
        key: documentFile.key,
        originalName: documentFile.originalname,
        size: documentFile.size,
        mimetype: documentFile.mimetype,
      },
      selfieFile: {
        url: selfieFile.location,
        key: selfieFile.key,
        originalName: selfieFile.originalname,
        size: selfieFile.size,
        mimetype: selfieFile.mimetype,
      },
    };

    const kycData = {
      userId: req.user._id,
      imageUrl: uploadedFiles.selfieFile.url,
      documentUrl: uploadedFiles.documentFile.url,
      status: "pending",
    };

    const savedKyc = await new Kyc(kycData).save();

    console.log(`KYC saved for user: ${req.user._id}`, {
      kycId: savedKyc._id,
      status: savedKyc.status,
      timestamp: new Date().toISOString(),
    });

    return res.status(201).json({
      success: true,
      message: "KYC documents uploaded successfully",
      data: {
        kycId: savedKyc._id,
        status: savedKyc.status,
        submittedAt: savedKyc.createdAt,
        files: {
          documentFile: {
            originalName: uploadedFiles.documentFile.originalName,
            size: uploadedFiles.documentFile.size,
            type: uploadedFiles.documentFile.mimetype,
          },
          selfieFile: {
            originalName: uploadedFiles.selfieFile.originalName,
            size: uploadedFiles.selfieFile.size,
            type: uploadedFiles.selfieFile.mimetype,
          },
        },
      },
    });
  } catch (error) {
    console.error("KYC upload error:", {
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      timestamp: new Date().toISOString(),
    });

    if (error.name === "ValidationError") {
      const details = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        message: "KYC data validation failed",
        details,
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Duplicate entry",
        message: "KYC record already exists for this user",
      });
    }

    if (["MongoNetworkError", "MongoTimeoutError"].includes(error.name)) {
      return res.status(503).json({
        success: false,
        error: "Database connection failed",
        message: "Unable to connect to database. Please try again later.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "An unexpected error occurred",
      ...(process.env.NODE_ENV === "development" && { details: error.message }),
    });
  }
};

/**
 * Get KYC Status Controller
 * Retrieves the current KYC status for authenticated user
 */
const getKycStatus = async (req, res) => {
  try {
    // Validate authentication
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        message: "User must be authenticated to check KYC status",
      });
    }

    // Find KYC record
    const kyc = await Kyc.findOne({ userId: req.user._id })
      .select("status createdAt updatedAt reviewedAt reviewedBy")
      .populate("reviewedBy", "name email");

    if (!kyc) {
      return res.json({
        success: true,
        error: "KYC not found",
        message: "No KYC submission found for this user",
      });
    }

    return res.status(200).json({
      success: true,
      message: "KYC status retrieved successfully",
      data: {
        status: kyc.status,
        submittedAt: kyc.createdAt,
        lastUpdated: kyc.updatedAt,
        reviewedAt: kyc.reviewedAt,
        reviewedBy: kyc.reviewedBy,
      },
    });
  } catch (error) {
    console.error("Get KYC status error:", {
      error: error.message,
      userId: req.user?._id,
      timestamp: new Date().toISOString(),
    });

    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "An unexpected error occurred while retrieving KYC status",
    });
  }
};

/**
 * Update KYC Status Controller (Admin only)
 * Updates KYC verification status
 */
const updateKycStatus = async (req, res) => {
  try {
    const { kycId } = req.params;
    const { status, reviewNotes } = req.body;

    // Validate admin authentication
    if (!req.user || !req.user._id || !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Access denied",
        message: "Admin privileges required to update KYC status",
      });
    }

    // Validate KYC ID
    if (!mongoose.Types.ObjectId.isValid(kycId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid KYC ID",
        message: "KYC ID must be a valid MongoDB ObjectId",
      });
    }

    // Validate status
    const validStatuses = ["pending", "verified", "not_verified"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status",
        message: `Status must be one of: ${validStatuses.join(", ")}`,
        validStatuses,
      });
    }

    // Find and update KYC record
    const kyc = await Kyc.findById(kycId);
    if (!kyc) {
      return res.status(404).json({
        success: false,
        error: "KYC not found",
        message: "KYC record not found",
      });
    }

    // Update KYC status
    kyc.status = status;
    kyc.reviewedAt = new Date();
    kyc.reviewedBy = req.user._id;
    if (reviewNotes) {
      kyc.reviewNotes = reviewNotes;
    }

    const updatedKyc = await kyc.save();

    console.log(`KYC status updated:`, {
      kycId: updatedKyc._id,
      userId: updatedKyc.userId,
      newStatus: status,
      reviewedBy: req.user._id,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "KYC status updated successfully",
      data: {
        kycId: updatedKyc._id,
        userId: updatedKyc.userId,
        status: updatedKyc.status,
        reviewedAt: updatedKyc.reviewedAt,
        reviewedBy: updatedKyc.reviewedBy,
      },
    });
  } catch (error) {
    console.error("Update KYC status error:", {
      error: error.message,
      adminId: req.user?._id,
      timestamp: new Date().toISOString(),
    });

    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "An unexpected error occurred while updating KYC status",
    });
  }
};

const getAllKYCs = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", status } = req.query;

    const query = {};

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      const users = await User.find({
        $or: [
          { email: { $regex: search, $options: "i" } },
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      query.userId = { $in: users.map(u => u._id) };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const totalDocuments = await Kyc.countDocuments(query);
    const totalPages = Math.ceil(totalDocuments / parseInt(limit));

    const kycs = await Kyc.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .populate("userId", "firstName lastName email country");

    const allKYCs = await Kyc.find(query)
      .sort({ createdAt: -1 })
      .populate("userId", "firstName lastName email country");

    res.status(200).json({
      success: true,
      data: kycs.map(k => ({
        ...k.toObject(),
        userInfo: {
          firstName: k.userId.firstName,
          lastName: k.userId.lastName,
          email: k.userId.email,
          country: k.userId.country,
        },
      })),
      allData: allKYCs.map(k => ({
        ...k.toObject(),
        userInfo: {
          firstName: k.userId.firstName,
          lastName: k.userId.lastName,
          email: k.userId.email,
          country: k.userId.country,
        },
      })),
      totalDocuments,
      totalPages,
      currentPage: parseInt(page),
    });
  } catch (err) {
    console.error("Get all KYCs error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch KYCs",
    });
  }
};

const approveKYC = async (req, res) => {
  try {
    const { kycId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(kycId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid KYC ID",
      });
    }

    const kyc = await Kyc.findByIdAndUpdate(
      kycId,
      {
        status: "verified",
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
      },
      { new: true },
    ).populate("userId", "firstName lastName email");

    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: "KYC not found",
      });
    }

    await User.findByIdAndUpdate(kyc.userId, {
      isVeriffVerified: true,
    });

    res.status(200).json({
      success: true,
      message: "KYC approved successfully",
      data: kyc,
    });
  } catch (err) {
    console.error("Approve KYC error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to approve KYC",
    });
  }
};

const rejectKYC = async (req, res) => {
  try {
    const { kycId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(kycId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid KYC ID",
      });
    }

    const kyc = await Kyc.findByIdAndUpdate(
      kycId,
      {
        status: "rejected",
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
        rejectionReason: reason,
      },
      { new: true },
    ).populate("userId", "firstName lastName email");

    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: "KYC not found",
      });
    }

    await User.findByIdAndUpdate(kyc.userId, {
      isVeriffVerified: false,
    });

    res.status(200).json({
      success: true,
      message: "KYC rejected successfully",
      data: kyc,
    });
  } catch (err) {
    console.error("Reject KYC error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to reject KYC",
    });
  }
};

const toggleKycVerification = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid User ID",
      });
    }

    const validStatuses = ["pending", "verified", "rejected"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const kyc = await Kyc.findOneAndUpdate(
      { userId },
      {
        status,
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
      },
      { new: true },
    );

    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: "No KYC found for this user",
      });
    }

    await User.findByIdAndUpdate(userId, {
      isVeriffVerified: status === "verified",
    });

    res.status(200).json({
      success: true,
      message: `KYC status updated to ${status}`,
      data: kyc,
    });
  } catch (err) {
    console.error("Toggle KYC verification error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update KYC status",
    });
  }
};

const getKYCDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid KYC ID",
      });
    }

    const kyc = await Kyc.findById(documentId);

    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: "KYC document not found",
      });
    }
    res.status(200).json({
      success: true,
      data: {
        documentUrl: kyc.documentUrl,
        imageUrl: kyc.imageUrl,
      },
    });
  } catch (err) {
    console.error("Get KYC document error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch KYC document",
    });
  }
};

const getKycByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid User ID",
      });
    }

    const kyc = await Kyc.findOne({ userId })
      .select(
        "status createdAt updatedAt reviewedAt reviewedBy rejectionReason",
      )
      .populate("reviewedBy", "firstName lastName email");

    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: "No KYC found for this user",
      });
    }

    res.status(200).json({
      success: true,
      data: kyc,
    });
  } catch (err) {
    console.error("Get KYC by user error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch KYC",
    });
  }
};

module.exports = {
  uploadController,
  getKycStatus,
  updateKycStatus,
  getAllKYCs,
  approveKYC,
  rejectKYC,
  getKYCDocument,
  getKycByUserId,
  toggleKycVerification,
};
