const Certificate = require("../models/Certificate");
const UserCertificate = require("../models/userCertificate");
const User = require("../models/user");
const puppeteer = require('puppeteer');

async function saveUserCertificate({
  userId,
  accountId,
  certificateId,
  htmlTemplate,
  title,
}) {
  try {
    // Create a new instance of UserCertificate with the provided data
    const userCertificate = new UserCertificate({
      userId,
      accountId,
      certificateId,
      htmlTemplate,
      title,
    });
    console.log("userCertificate: ", userCertificate);

    // Save the instance to the database
    const savedCertificate = await userCertificate.save();

    // Return the saved document
    return savedCertificate;
  } catch (error) {
    console.error("Error saving UserCertificate:", error.message);
    throw new Error("Unable to save the UserCertificate. Please try again.");
  }
}

const getCertificatesByUserId = async userId => {
  try {
    // Find all user certificates for the given userId
    const userCertificates = await UserCertificate.find({
      userId,
      isDeleted: false,
    }).select("certificateId title accountId awardedDate");

    return userCertificates;
  } catch (error) {
    console.error("Error fetching user certificates:", error.message);
    throw new Error("Unable to fetch user certificates.");
  }
};
const getCertificatesById = async id => {
  try {
    // Find all user certificates for the given userId
    const userCertificates = await UserCertificate.findById(id);

    return userCertificates;
  } catch (error) {
    console.error("Error fetching user certificates:", error.message);
    throw new Error("Unable to fetch user certificates.");
  }
};

const createCertificate = async (req, res) => {
  try {
    const { title, description, htmlTemplate, challengeName } = req.body;

    if (!title || !htmlTemplate || !challengeName) {
      return res.status(400).json({
        message:
          "Title, HTML Template, Awarded To, and Challenge Name are required.",
      });
    }

    const newCertificate = new Certificate({
      title,
      description,
      htmlTemplate,
      challengeName,
      variables: ["firstName", "lastName", "accountSize", "profitAfterSplit"],
      awardedDate: new Date(),
    });

    await newCertificate.save();

    res.status(201).json({
      message: "Certificate created successfully",
      certificate: newCertificate,
    });
  } catch (error) {
    console.error("Error creating certificate:", error);
    res
      .status(500)
      .json({ message: "An error occurred while creating the certificate" });
  }
};

const updateCertificate = async (req, res) => {
  try {
    const { id: certificateId } = req.params;
    const certificateData = req.body;

    const { error } = updateCertificateJoiSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details,
      });
    }

    const certificate = await Certificate.findById(certificateId);

    if (!certificate || certificate.isDeleted) {
      return res
        .status(404)
        .json({ success: false, message: "Certificate not found" });
    }

    const updatedCertificate = await Certificate.findByIdAndUpdate(
      certificateId,
      { $set: certificateData },
      { new: true },
    );

    if (!updatedCertificate) {
      return res
        .status(404)
        .json({ success: false, message: "Certificate not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Certificate updated successfully",
      certificate: updatedCertificate,
    });
  } catch (error) {
    console.error("Error updating certificate:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const deleteCertificate = async (req, res) => {
  try {
    const { id: certificateId } = req.params;

    const certificate = await Certificate.findById(certificateId);

    if (!certificate || certificate.isDeleted) {
      return res
        .status(404)
        .json({ success: false, message: "Certificate not found" });
    }

    if (certificate?.isDeleted === undefined) {
      certificate.isDeleted = true;
    } else {
      certificate.isDeleted = true;
    }

    const updatedCertificate = await certificate.save();

    return res.status(200).json({
      success: true,
      message: "Certificate marked as deleted successfully",
      certificate: updatedCertificate,
    });
  } catch (error) {
    console.error("Error marking certificate as deleted:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const getAllCertificates = async (req, res) => {
  try {
    const userCertificates = await Certificate.find({});

    res.status(200).json({
      success: true,
      certificates: userCertificates,
      message: "Certificates retrieved successfully",
    });
  } catch (error) {
    console.error("Error fetching user certificates:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching certificates",
    });
  }
};


//Currently using

const downloadCertificatePDF = async (req, res) => {
  try {
    const userCertificateId = req.query.certificateId;
    if (!userCertificateId) {
      return res.status(400).json({
        success: false,
        message: "certificateId is required"
      });
    }
    // 1) Fetch the UserCertificate, ensure it belongs to this user and is not deleted
    const userCert = await UserCertificate.findOne({
      _id: userCertificateId,
      userId: req.user._id,
      isDeleted: false
    }).select("htmlTemplate").lean();

    if (!userCert) {
      return res.status(404).json({
        success: false,
        message: "UserCertificate not found or already deleted"
      });
    }

    // 2) Launch Puppeteer, convert HTML → PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();

    // Set a slightly higher navigation timeout if needed
    await page.setDefaultNavigationTimeout(60000);

    // Use the stored HTML directly (no replacements needed)
    await page.setContent(userCert.htmlTemplate, { waitUntil: "networkidle2" });

    // Generate PDF (A4) with background graphics
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true
    });

    await browser.close();

    // 3) Stream the PDF back to the client
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=certificate.pdf");
    return res.send(pdfBuffer);

  } catch (err) {
    console.error("downloadUserCertificatePDF error:", err);
    return res.status(500).json({
      success: false,
      message: "PDF generation failed",
      error: err.message
    });
  }
};

const downloadCertificateImage = async (req, res) => {
  try {
    const userCertificateId = req.query.certificateId;
    // 1) Fetch the UserCertificate, ensure it belongs to this user and is not deleted
    const userCert = await UserCertificate.findOne({
      _id: userCertificateId,
      userId: req.user._id,
      isDeleted: false
    }).select("htmlTemplate").lean();

    if (!userCert) {
      return res.status(404).json({
        success: false,
        message: "UserCertificate not found or already deleted"
      });
    }

    // 2) Launch Puppeteer, convert HTML → PNG
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();

    // You can adjust viewport width/height if desired
    await page.setViewport({ width: 1200, height: 800 });
    await page.setContent(userCert.htmlTemplate, { waitUntil: "networkidle2" });

    // Give it a moment to fully render any external assets
    await page.waitForTimeout(500);

    // Take a full-page screenshot
    const imageBuffer = await page.screenshot({
      type: "png",
      fullPage: true
    });

    await browser.close();

    // 3) Stream the PNG back to the client
    res.setHeader("Content-Disposition", "attachment; filename=certificate.png");
    res.setHeader("Content-Type", "image/png");
    return res.send(imageBuffer);

  } catch (err) {
    console.error("downloadUserCertificateImage error:", err);
    return res.status(500).json({
      success: false,
      message: "Image generation failed",
      error: err.message
    });
  }
};


const assignCertificate = async (req, res) => {
    const {
      certificateId,
      accountId,
      userId,
      variableValues = {} // Object containing variable replacements
    } = req.body;
    // Validate required fields
    if (!userId || !certificateId || !accountId) {
      return res.status(400).json({
        success: false,
        message: "userId, certificateId, and accountId are required"
      });
    }
  await assignCertificateToUser(certificateId, userId, variableValues, accountId, res);
};
const assignCertificateToUser = async (certificateId, userId, variableValues, accountId, res) => {
  try {

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    variableValues.awardDate = new Date().toLocaleDateString(); // Add award date to variable values
    // Check if certificate exists
    const certificate = await Certificate.findById(certificateId);
    if (!certificate || certificate.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Certificate not found or has been deleted"
      });
    }

    // Check if user already has this certificate for the same account
    const existingUserCertificate = await UserCertificate.findOne({
      userId,
      certificateId,
      accountId,
      isDeleted: false
    });

    if (existingUserCertificate) {
      return res.status(409).json({
        success: false,
        message: "User already has this certificate for the specified account"
      });
    }

    // Process HTML template with variables
    let processedHtmlTemplate = certificate.htmlTemplate;

    // Replace variables in the HTML template
    if (certificate.variables && certificate.variables.length > 0) {
      certificate.variables.forEach(variable => {
        const variableName = variable.name || variable; // Handle both object and string formats
        const placeholder = `{{${variableName}}}`;
        const value = variableValues[variableName] || `[${variableName}]`; // Use provided value or placeholder

        // Replace all occurrences of the variable
        processedHtmlTemplate = processedHtmlTemplate.replace(
          new RegExp(placeholder, 'g'),
          value
        );
      });
    }


    // Create new user certificate
    const userCertificate = new UserCertificate({
      userId,
      accountId,
      title: certificate.title,
      certificateId,
      htmlTemplate: processedHtmlTemplate,
      variables: variableValues,
      awardedDate: new Date()
    });

    // Save the user certificate
    await userCertificate.save();

    // Populate the response with certificate details
    await userCertificate.populate([
      {
        path: 'userId',
        select: 'firstName lastName userName email'
      },
      {
        path: 'certificateId',
        select: 'title description'
      }
    ]);

    return res.status(201).json({
      success: true,
      message: "Certificate assigned successfully",
      data: {
        userCertificate,
        processedVariables: Object.keys(variableValues).length > 0 ? variableValues : null
      }
    });

  } catch (error) {
    console.error("Error assigning certificate:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
}

const getUserCertificates = async (req, res) => {
  try {
    const userId = req.query.userId || req.user._id;
    const certificates = await UserCertificate
      .find({ userId, isDeleted: false })
      .select("-htmlTemplate")      // <-- this removes htmlTemplate from the returned docs
      .lean();

    return res.status(200).json({
      success: true,
      data: certificates
    });
  } catch (err) {
    console.error("getUserCertificates error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user certificates",
      error: err.message
    });
  }
};
module.exports = {
  createCertificate,
  updateCertificate,
  deleteCertificate,
  getAllCertificates,
  getUserCertificates,
  downloadCertificatePDF,
  downloadCertificateImage,
  saveUserCertificate,
  assignCertificate,
  assignCertificateToUser
};
