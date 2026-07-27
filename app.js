const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const app = express();
const MongoDBStore = require("connect-mongodb-session")(session);
const port = 3000;
const path = require("path");
const Book = require("./models/Book");
const Order = require("./models/order");
const socketIO = require("socket.io");
const http = require("http");
const bcrypt = require("bcrypt");
const multer = require("multer");
const server = http.createServer(app);
const io = socketIO(server);
const Razorpay = require("razorpay");
const crypto = require("crypto");


const Rating = require("./models/Ratings");
const User = require("./models/User");
require("dotenv").config();
// Database connection setup
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const mongoUri = process.env.MONGO_URI_PRODUCTION;
// const mongoUri = process.env.MONGO_URI_LOCAL;

mongoose
  .connect(mongoUri, {
    // useNewUrlParser: true,
    // useUnifiedTopology: true,
  })
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection error", err);
  });

// Middleware setup
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up body parser middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Create a new MongoDB session store
const store = new MongoDBStore({
  uri: mongoUri, // Use the same URI for session storage
  collection: "sessions",
});

// Catch errors in the session store
store.on("error", (error) => {
  console.error("Session store error:", error);
});

// Configure session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Change this to a secret key for session encryption
    resave: false,
    saveUninitialized: false,
    store: store,
  })
);

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.get("/index", (req, res) => {
  res.render("index"); // Render the index.ejs file
});

// Import the auth router
const authRouter = require("./routes/auth");
const bookRoutes = require("./routes/books");

// Use the authRouter for dashboard and login routesapp.get("/categories"
app.use("/auth", authRouter);
app.use("/books", bookRoutes);
// let showDropdown;
app.get("/", async (req, res) => {
  const user = req.session.user;

  try {
    const books = await Book.find({});
    const ratings = await Rating.find({});

    const showDropdown = !!user; // true if user exists

    res.render("index", {
      user,
      books,
      ratings,
      showDropdown,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});
// app.get('/', (req, res) => {
//     const user = req.session.user;
//     let ratings;
//     if (user) {
//         Book.find({})
//             .exec()
//             .then(books => {
//                 showDropdown = true;
//                 res.render('index', { user, books, showDropdown });
//             })
//             .catch(err => {
//                 console.error('Error:', err);
//                 res.status(500).json({ success: false, message: 'Internal server error' });
//             });
//     } else {
//         Book.find({})
//             .exec()
//             .then(books => {
//                 showDropdown = false;
//                 res.render('index', { user, books, showDropdown });
//             })
//             .catch(err => {
//                 console.error('Error:', err);
//                 res.status(500).json({ success: false, message: 'Internal server error' });
//             });
//     }
// });

app.get("/add_book", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "add_book.html"));
});

app.get("/get-user", (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
});

app.get("/get-logged-in-user-id", (req, res) => {
  // Check if the user is logged in
  if (req.session.user && req.session.user._id) {
    res.json({ userId: req.session.user._id }); // Send the user ID in the response
  } else {
    res.status(401).json({ error: "User not logged in" }); // Send an error if the user is not logged in
  }
});

app.get("/bookdetails", async (req, res) => {
  const bookId = req.query.id; // Get the book ID from the query parameter
  const user = req.session.user;
  try {
    const book = await Book.findById(bookId);
    if (book) {
      res.render("bookdetails", { book, showDropdown, user });
    } else {
      // res.status(404).send('Book not found');
      res.status(404).send(`
        <p>Book not found</p>
        <script>
            setTimeout(function(){
                window.location.href = '/';
            }, 2000); // Redirects after 5 seconds
        </script>
    `);
    }
  } catch (error) {
    res.status(500).send("Internal Server Error");
  }
});

// Add this route to handle search requests
app.get("/search", async (req, res) => {
  const user = req.session.user;
   const showDropdown = !!user;
  const query = req.query.q;
  try {
    const results = await Book.find({
      $or: [
        { title: { $regex: new RegExp(query, "i") } },
        { author: { $regex: new RegExp(query, "i") } },
      ],
    });
    res.render("searchresults", { results, query, showDropdown, user }); // Pass results to the view
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/admin", async (req, res) => {
  try {
    // Check if the admin session exists
    if (req.session && req.session.admin) {
      // Fetch total number of users
      const totalUsers = await User.countDocuments();
      const totalBooks = await Book.countDocuments();
      // If the session exists, render the admin page with total users count
      res.render("admin", { totalUsers, totalBooks });
    } else {
      // If the session does not exist, redirect the user to the login page
      res.redirect("/");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/userprofile", (req, res) => {
  const userId = req.session.user._id; // Assuming you store user ID in the session

  // Fetch user details from the database
  User.findById(userId)
    // const user = await User.findById(id)
    .then((user) => {
      if (user) {
        console.log("Profile Pic:", user.profilePic);
        res.render("userprofile", { user });
      } else {
        res.status(404).send("User not found");
      }
    })
    .catch((error) => {
      console.error(error);
      res.status(500).send("Internal Server Error");
    });
});

app.get("/reset-password", (req, res) => {
  // Render the password reset form
  res.render("reset-password");
});

app.post("/reset-password", async (req, res) => {
  const userId = req.session.user._id; // Assuming you store user ID in the session
  const newPassword = req.body.newPassword;

  try {
    // Fetch user from the database
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).send("User not found");
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    user.password = hashedPassword;
    await user.save();

    // Respond to the client
    res.status(200).send("Password reset successful!");
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/allBooks", async (req, res) => {
  try {
    const books = await Book.find();
    if (books.length > 0) {
      // Check if books array is not empty
      res.status(200).json({ books: books }); // Send books as JSON with status code 200
    } else {
      res.status(404).send("No books found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/favorites", async (req, res) => {
  try {
    // Retrieve the user's favorites from the database
    const userId = req.session.user._id;
    const user = await User.findById(userId).populate("favorites");
    const favorites = user.favorites;

    // Render the favorites page (favorites.ejs) with the favorites data
    res.render("favorites", { favorites: favorites, showDropdown, user });
  } catch (error) {
    // Handle errors
    console.error("Error fetching favorites:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

app.get("/categories", async (req, res) => {
  try {
    const categories =
      await Book.distinct("category").exec();

    console.log(categories);

    const user = req.session.user;
    const showDropdown = !!user;

    const groupedBooks = {};

    for (const category of categories) {
      groupedBooks[category] =
        await Book.find({
          category: category
        }).exec();
    }

    console.log(groupedBooks);

    res.render("categories", {
      groupedBooks,
      showDropdown,
      user
    });

  } catch (error) {
    console.error(error);
  }
});

app.get("/books/owner/:bookId", async (req, res) => {
  const bookId = req.params.bookId;
  try {
    // Fetch book details from MongoDB
    const book = await Book.findById(bookId).exec();
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }
    const owner = {
      name: book.user,
    };
    res.json({ owner });
  } catch (error) {
    console.error("Error fetching owner details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/user-rating-review", async (req, res) => {
  try {
    const userId = req.session.user ? req.session.user._id : null; // Check if user is defined
    const bookId = req.query.bookId;
    if (!userId) {
      return res.json({ rating: null, review: null });
    }
    const ratingReview = await Rating.findOne({
      userId: userId,
      bookId: bookId,
    }).select("rating review");
    res.json({
      rating: ratingReview ? ratingReview.rating : null,
      review: ratingReview ? ratingReview.review : null,
    });
  } catch (error) {
    console.error("Error fetching user rating and review:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update the submit-rating-review endpoint to handle cases where user is not logged in
app.post("/submit-rating-review", async (req, res) => {
  try {
    const userId = req.session.user ? req.session.user._id : null; // Check if user is defined
    if (!userId) {
      return res.status(401).json({ error: "User not logged in" }); // Send a 401 Unauthorized status if user is not logged in
    }
    const { bookId, rating, review, bookimg, name } = req.body;
    const existingRatingReview = await Rating.findOne({
      userId: userId,
      bookId: bookId,
    });
    if (existingRatingReview) {
      return res
        .status(400)
        .json({ error: "You have already rated and reviewed this book" });
    }
    const newRatingReview = new Rating({
      userId: userId,
      bookId: bookId,
      rating: rating,
      review: review,
      bookimg: bookimg,
      username: name,
    });
    await newRatingReview.save();
    res.status(200).json({
      success: true,
      message: "Rating and review submitted successfully",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    const options = {
      amount: amount * 100, // Convert ₹ to paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    res.json(order);
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    res.status(500).json({
      success: false,
      message: "Unable to create order",
    });
  }
});
app.post("/verify-payment", (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature === razorpay_signature) {
    return res.json({
      success: true,
      message: "Payment Verified Successfully",
    });
  } else {
    return res.status(400).json({
      success: false,
      message: "Payment Verification Failed",
    });
  }
});
app.get("/orders", (req, res) => {
    res.render("orders");
});
// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
