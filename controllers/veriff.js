// const Veriff = require('@veriff/js-sdk');
const axios = require("axios");
const crypto = require("crypto");
const User = require("../models/user");
const sendEmail = require("../utils/sendEmail");

const createHmacSignature = (sessionId, sharedSecretKey) => {
  return crypto
    .createHmac("sha256", sharedSecretKey)
    .update(sessionId)
    .digest("hex");
};


//DECISION
const handleVeriffDecisionWebhook = async (req, res) => {
  try {
    console.log('DECISION WEBHOOK HITTT');

    // Step 1: Verify the webhook signature (for security)
    const sharedSecretKey = process.env.VERIFF_SHARED_SECRET_KEY;
    const hmacSignature = req.headers['x-hmac-signature'];
    const payload = JSON.stringify(req.body);

    if (!hmacSignature) {
      console.error('Missing X-HMAC-SIGNATURE header');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Missing X-HMAC-SIGNATURE header.',
      });
    }

    const calculatedSignature = createHmacSignature(payload, sharedSecretKey);
    if (hmacSignature !== calculatedSignature) {
      console.error('Invalid X-HMAC-SIGNATURE');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid X-HMAC-SIGNATURE.',
      });
    }

    // Step 2: Validate the webhook payload
    if (
      !req.body.status ||
      !req.body.verification ||
      !req.body.verification.status ||
      !req.body.verification.id
    ) {
      console.error('Invalid webhook payload:', req.body);
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook payload: Missing required fields.',
      });
    }

    // Step 3: Handle approved verification
    if (
      req.body.status === 'success' &&
      req.body.verification.status === 'approved'
    ) {
      const user = await User.findOne({
        veriffSessionId: req.body.verification.id,
      });

      if (!user) {
        console.error(
          'No user found with Veriff session ID:',
          req.body.verification.id
        );
        return res.status(404).json({
          success: false,
          message: 'No user found with this Veriff session ID.',
        });
      }

      if (user.isVeriffVerified) {
        console.log('User is already verified by Veriff:', user._id);
        return res.status(200).json({
          success: true,
          message: 'User is already verified by Veriff.',
          isVeriffVerified: user.isVeriffVerified,
        });
      }

      // Update user verification status
      user.isVeriffVerified = true;
      await user.save();
      console.log('User verification status updated:', user._id);

      // Send KYC approval email
      const emailData = {
        to: user.email,
        isTemp: true,
        subject: 'VERIFF APPROVED',
        htmlFile: 'KYC-Approved.html',
        dynamicData: {
          firstname: user.firstName,
        },
      };

      try {
        // Uncomment and handle email sending
        await sendEmail(emailData);
        console.log('KYC approval email sent successfully to:', user.email);
      } catch (emailError) {
        console.error('Failed to send KYC approval email:', emailError);
      }

      return res.status(200).json({
        success: true,
        message: 'User verification status updated successfully.',
        isVeriffVerified: user.isVeriffVerified,
      });
    }else{
      // Send KYC approval email
      const emailData = {
        to: user.email,
        isTemp: true,
        subject: 'VERIFF REJECTED',
        htmlFile: 'KYC-Rejected.html',
        dynamicData: {
          reason: request.body.message,
        },
      };

      try {
        // Uncomment and handle email sending
        await sendEmail(emailData);
        console.log('KYC approval email sent successfully to:', user.email);
      } catch (emailError) {
        console.error('Failed to send KYC approval email:', emailError);
        }
    }

    // Step 4: Handle other verification statuses (optional)
    console.log('Webhook received with status:', req.body.verification.status);
    return res.status(200).json({
      success: true,
      message: 'Webhook received successfully.',
      data: req.body,
    });
  } catch (error) {
    console.error('Error processing Veriff webhook:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
};



const createVeriffSession = async (req, res) => {
  try {
    const reqUser = req.user;
    const user = await User.findById(reqUser._id);

    if (!reqUser || !user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated"
      });
    }

    if (user.isVeriffVerified) {
      return res.status(200).json({
        success: true,
        message: "User is already verified by Veriff"
      });
    }

    // Validate required fields
    const requiredFields = ['firstName', 'lastName', 'IdCardNum', 'country', 'fullAddress'];
    const missingFields = requiredFields.filter(field => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const verificationData = {
      verification: {
        callback: `${process.env.FRONTEND_BASE_URL}/dashboard`,
        person: {
          firstName: req.body.firstName || reqUser.firstName,
          lastName: req.body.lastName || reqUser.lastName,
          idNumber: req.body.IdCardNum
        },
        document: {
          number: req.body.IdCardNum,
          type: "ID_CARD",  // Changed to uppercase as per Veriff docs
          country: req.body.country.toUpperCase() // Country code should be uppercase
        },
        vendorData: req.body.IdCardNum, // Added for tracking
        timestamp: new Date().toISOString()
      }
    };

    // Remove optional fields that might cause validation issues
    if (req.body.fullAddress) {
      verificationData.verification.address = {
        fullAddress: req.body.fullAddress
      };
    }

    const config = {
      method: "post",
      url: "https://stationapi.veriff.com/v1/sessions/",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-CLIENT": process.env.VERIFF_API_KEY
      },
      data: verificationData
    };

    const response = await axios.request(config);

    if (response.data?.verification?.id) {
      user.veriffSessionId = response.data.verification.id;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Veriff session created successfully",
        data: response.data
      });
    }

    return res.status(400).json({
      success: false,
      message: "Failed to create Veriff session",
      data: response.data
    });

  } catch (error) {
    console.error("Veriff Session Creation Error:", error.response?.data || error);

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to create Veriff session",
      error: {
        code: error.response?.data?.code,
        message: error.response?.data?.message
      }
    });
  }
};


const checkUserVeriffStatus = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(400).json({
        success: false,
        message: 'User information is missing or invalid.',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    if (user.isVeriffVerified) {
      return res.status(200).json({
        success: true,
        message: 'User is already verified by Veriff.',
        isVeriffVerified: user.isVeriffVerified,
      });
    }

    if (!user.veriffSessionId) {
      return res.status(200).json({
        success: true,
        message: 'You need to complete the Veriff Verification Flow first.',
        isVeriffVerified: false,
      });
    }

    const sharedSecretKey = process.env.VERIFF_SHARED_SECRET_KEY;
    const hmacSignature = createHmacSignature(
      user.veriffSessionId,
      sharedSecretKey
    );

    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `https://stationapi.veriff.com/v1/sessions/${user.veriffSessionId}/decision`,
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-SIGNATURE': hmacSignature,
        'X-AUTH-CLIENT': process.env.VERIFF_API_KEY,
      },
    };

    const response = await axios.request(config);
    console.log('Verification Status:', response.data);

    if (
      response.data?.status === 'success' &&
      response.data?.verification?.status === 'approved'
    ) {
      user.isVeriffVerified = true;
      await user.save();

      // Send KYC approval email
      const emailData = {
        to: user.email,
        subject: 'Veriff KYC Verification Approved',
        isTemp: true,
        template: 'kyc approved',
        variablesObject: {
          firstName: user.firstName,
        },
      };

      try {
        // Uncomment and handle email sending
        // await sendEmail(emailData);
      } catch (emailError) {
        console.error('Failed to send KYC approval email:', emailError);
      }

      return res.status(200).json({
        success: true,
        message:
          'Verification status retrieved successfully. User is now verified.',
        isVeriffVerified: user.isVeriffVerified,
      });
    } else {
      return res.status(200).json({
        success: true,
        message: 'Verification is still in progress.',
        isVeriffVerified: false,
      });
    }
  } catch (error) {
    console.error('Error checking verification status:', error);

    // Handle specific Veriff API errors
    if (error.response) {
      console.error('Veriff API Error:', error.response.data);
      return res.status(error.response.status).json({
        success: false,
        message: 'Failed to retrieve verification status from Veriff API.',
        error: error.response.data,
      });
    }

    // Handle other errors
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve verification status.',
      error: error.message,
    });
  }
};


module.exports = {
  checkUserVeriffStatus,
  createVeriffSession,
  handleVeriffDecisionWebhook,
};
