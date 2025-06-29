const fs = require('fs');
const path = require('path');
const mailgun = require('mailgun-js');
// Configure Mailgun
const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN
});

const sendEmail = async (options) => {
  // Validate required parameters
  if (!options.to || !options.subject) {
    throw new Error('Missing required email parameters');
  }
  let emailData;
  if (options.html) {
    emailData = {
      from: options.from || `The Pride Funding <no-reply@${process.env.MAILGUN_DOMAIN}>`,
      to: options.to,
      subject: options.subject,
      html: options.html
    };
  } else if (options.htmlFile) {
    // Read the HTML template file
    const templatePath = path.join('templates', `${options.htmlFile}`);
    // Check if file exists
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    let htmlTemplate = fs.readFileSync(templatePath, 'utf-8');
    if (options.dynamicData) {
      Object.entries(options.dynamicData).forEach(([key, value]) => {
        const placeholder = `{{${key}}}`;
        const safeValue = value !== undefined && value !== null ? value.toString() : '';
        htmlTemplate = htmlTemplate.replace(new RegExp(placeholder, 'g'), safeValue);
      });
    }
    emailData = {
      from: options.from || `The Pride Funding <no-reply@${process.env.MAILGUN_DOMAIN}>`,
      to: options.to,
      subject: options.subject,
      html: htmlTemplate
    };
  } else {
    throw new Error('Missing required email parameters');
  }
  try {
    // Send email and return response
    const result = await mg.messages().send(emailData);
    // console.log('Email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

module.exports = sendEmail;