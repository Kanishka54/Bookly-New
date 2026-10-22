const mongoose = require("mongoose");

// Define the User model schema here
const userSchema = new mongoose.Schema({
  name: String,
  email: {
    type: String,
    unique: true,
  },
  password: String,
  profilePic: String,
  blocked: {
    type: Boolean,
    default: false,
  },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
  phone: String,
  mobileCart: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
});

module.exports = mongoose.model("User", userSchema);
