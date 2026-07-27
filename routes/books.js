const express = require("express");
const path = require("path");

const router = express.Router();
const Book = require("../models/Book");
const upload = require("../middleware/multer.middleware.js"); // Adjust path as necessary
const {
  uploadOnCloudinary,
  deleteFromCloudinary,
} = require("../utils/cloudinary"); // Adjust path as necessary

const User = require("../models/User");
const fs = require("fs");

// // Configure multer for handling file uploads
// const storage = multer.diskStorage({
//   // Configuration for file storage
//   destination: function (req, file, cb) {
//     cb(null, "public/uploads"); // Store the uploaded images in the "public/uploads" directory
//   },
//   filename: function (req, file, cb) {
//     // cb(null, Date.now() + '-' + file.originalname); // Generate unique file names
//     const uniqueFilename = `${Date.now()}-${file.originalname}`;
//     cb(null, uniqueFilename);
//     // Save the unique filename to the request object so it can be accessed in the route handler
//     req.uniqueFilename = uniqueFilename;
//   },
// });

// const upload = multer({ storage: storage });

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    return res
      .status(401)
      .json({ error: "You must be logged in to access this feature." });
  }
}

router.get("/checkAuthentication", isAuthenticated, (req, res) => {
  res.json({ isAuthenticated: true });
});

router.post(
  "/addbook",
  isAuthenticated,
  upload.single("image"),
  async (req, res) => {
    const userEmail = req.session.user.email;

    try {
      const {
        title,
        author,
        publication_year,
        description,
        price,
        publisher,
        language,
        quantity,
        category,
        condition,
      } = req.body;

      const user = req.session.user.name;
      const userphn = req.session.user.phone;

      console.log("req.file =", req.file);

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Image not uploaded",
        });
      }

      const filename = req.file.filename;
      const filePath = path.join("public", "uploads", filename);

      console.log("Uploaded file name:", filename);

      const cloudinaryResult = await uploadOnCloudinary(filePath);

      if (!cloudinaryResult) {
        throw new Error("Failed to upload image to Cloudinary.");
      }

      const cloudinaryUrl = cloudinaryResult.secure_url;
      console.log("Uploaded file URL:", cloudinaryUrl);

      const newBook = new Book({
        user,
        title,
        author,
        publication_year,
        description,
        price,
        publisher,
        language,
        image: cloudinaryUrl,
        userEmail,
        quantity,
        category,
        condition,
        userphn,
      });

      await newBook.save();

      res.status(200).json({
        success: true,
        message: "Book added to the database.",
      });

    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error.",
      });
    }
  }
);
// Route to get all book details
router.get("/Books", async (req, res) => {
  try {
    const books = await Book.find();
    // console.log(books);
    if (books) {
      res.render("products", { loading: false, products: books });
    } else {
      res.status(404).send("No books found");
    }
  } catch (error) {
    res.status(500).send("Internal Server Error");
  }
});

router.post(
  "/upload-profile-pic",
  isAuthenticated,
  upload.single("profilePic"),
  async (req, res) => {
    try {
      const localFilePath = req.file.path;
      const result = await uploadOnCloudinary(localFilePath);
      const profilePicUrl = result.secure_url;

      // Find the user and update their profilePic field
      const updatedUser = await User.findOneAndUpdate(
        { email: req.session.user.email },
        { profilePic: profilePicUrl },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(404).send("User not found");
      }

      res.redirect("/userprofile");
    } catch (err) {
      console.error(err);
      res.status(500).send("An error occurred while uploading the file.");
    }
  }
);

// Route to delete a book
router.get("/deletebook/:id", async (req, res) => {
  try {
    const book = await Book.findByIdAndDelete(req.params.id);

    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found." });
    }

    const imagePublicId = book.image.split("/").slice(-1)[0].split(".")[0];

    // Call the delete function from cloudinary.js
    const deleteResult = await deleteFromCloudinary(imagePublicId);
    if (deleteResult && deleteResult.result === "ok") {
      console.log("Image deleted successfully from Cloudinary.");
    } else {
      console.error("Image deletion failed or not found.");
    }

    res.json({ success: true, message: "Book deleted successfully." });
  } catch (error) {
    console.error("Error deleting book:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// Route to render the update form
router.get("/products/:id/update", async (req, res) => {
  try {
    const product = await Book.findById(req.params.id);
    if (!product) {
      return res.status(404).send("Product not found");
    }
    res.render("updateForm", { product });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

// Route to handle the update submission
router.post("/:id/update", async (req, res) => {
  try {
    const {
      title,
      author,
      publication_year,
      publisher,
      language,
      category,
      description,
      price,
      quantity,
    } = req.body;
    await Book.findByIdAndUpdate(req.params.id, {
      title,
      author,
      publication_year,
      publisher,
      language,
      category,
      description,
      price,
      quantity,
    });
    res.redirect("back");
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

// Endpoint to add a book to favorites
router.post("/addtofavorites", isAuthenticated, async (req, res) => {
  try {
    //console.log(req.body);
    // Extract book ID from request body
    const { bookId } = req.body;

    // Get the user ID from the logged-in user (assuming user object is stored in session)
    const userId = req.session.user._id;
    // console.log("user is" + userId);

    // Find the user by ID
    const user = await User.findById(userId);

    // Check if the book ID is already in the favorites array
    if (!user.favorites.includes(bookId)) {
      // If not, add the book ID to the favorites array
      user.favorites.push(bookId);

      // Save the updated user document
      await user.save();

      // Send a success response
      res
        .status(200)
        .json({ message: "Book added to favorites successfully." });
    } else {
      // If the book ID is already in favorites, send a message indicating it's already added
      res.status(400).json({ message: "Book already exists in favorites." });
    }
  } catch (error) {
    // Handle errors
    console.error("Error adding book to favorites:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// Assuming you've defined your Express app as 'app'
router.post("/removeFromFavorites", (req, res) => {
  const userId = req.session.user._id; // Assuming you have access to the user ID
  const bookId = req.query.id; // Assuming the book ID is passed as a query parameter

  // Find the user by ID
  User.findById(userId)
    .then((user) => {
      // Check if the user exists
      if (!user) {
        return res.status(404).send("User not found.");
      }

      // Check if the provided bookId is in the user's favorite book IDs array
      const index = user.favorites.indexOf(bookId);
      if (index !== -1) {
        // Book found in favorites, remove it from the array
        user.favorites.splice(index, 1);
        return user.save(); // Return the promise for chaining
      } else {
        console.log(
          `Book with ID ${bookId} is not in favorites of user ${userId}.`
        );
        return Promise.reject("Book not found in favorites."); // Reject the promise
      }
    })
    .then(() => {
      res.redirect("back");
    })
    .catch((err) => {
      console.error("Error removing book from favorites:", err);
      res.status(500).send("Error removing book from favorites."); // Send a 500 response if an error occurs
    });
});

module.exports = router;
