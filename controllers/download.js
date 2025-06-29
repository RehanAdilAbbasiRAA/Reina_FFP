const Download = require("../models/download");

const addDownload = async (req, res) => {
  try {
    const { title, description, image } = req.body;
    // Validate input
    if (!title || !description) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // Create a new Download
    const newDownload = new Download({
      title,
      description,
      image,
    });

    const savedDownload = await newDownload.save();

    // Send a response with the saved Download
    return res.status(201).json({
      message: "Download created successfully",
      data: savedDownload,
    });
  } catch (error) {
    console.error("Error creating Download:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const showDownload = async (req, res) => {
  try {
    const Downloads = await Download.find();
    return res.status(200).json({
      message: "Downloads retrieved successfully",
      data: Downloads,
    });
  } catch (error) {
    console.error("Error retrieving Downloads:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  addDownload,
  showDownload,
};
