const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
  console.log("Starting upload to Cloudinary...");
  try {
    if (!localFilePath) return null;

    // Upload file to Cloudinary
    const result = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    });
    console.log("Upload successful:", result);
    console.log("URL:", result.secure_url);

    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath); // Delete local file after upload
    }

    return result;
  } catch (error) {
    // Remove the locally saved file if the upload fails
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
    console.error("Error uploading to Cloudinary:", error);
    return null;
  }
};

// Function to delete an image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log("Delete result:", result);
    return result;
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    return null;
  }
};

// Export functions
module.exports = {
  uploadOnCloudinary,
  deleteFromCloudinary,
};
