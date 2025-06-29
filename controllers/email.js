const sendEmail = require("../utils/sendEmail");

const sendEmailController = async (req, res) => {
  try {
    const { to, subject, htmlFile, dynamicData, html } = req.body;

    // Send email
    const result = await sendEmail({
      to,
      subject,
      htmlFile,
      dynamicData, 
      html
    });

    res.status(200).json({
      message: 'Email sent successfully',
      result
    });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({
      message: 'Failed to send email',
      error: error.message
    });
  }
};

module.exports = {
  sendEmailController,
};
