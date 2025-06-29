const AWS = require("aws-sdk");

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Access Key ID from .env
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // Secret Access Key from .env
  region: process.env.AWS_REGION, // AWS region from .env
});

const s3 = new AWS.S3();

const uploadToS3 = async (fileBuffer, fileName) => {
  try {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: fileBuffer, // Use the buffer directly
    };

    const data = await s3.upload(params).promise();

    return data.Location; // Return the public URL
  } catch (err) {
    console.error("Error uploading to S3:", err.message);
    throw new Error("Failed to upload file to S3");
  }
};

module.exports = uploadToS3;
