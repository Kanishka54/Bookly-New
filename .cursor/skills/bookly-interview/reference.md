# Bookly map

Used-book marketplace. Sellers list a book. Buyers browse, search, save favourites, and pay with Razorpay. Stack: Node.js, Express, MongoDB, Mongoose, EJS, plain JavaScript. Images: Cloudinary. Mail: Nodemailer. Sessions: `express-session` stored in the MongoDB `sessions` collection.

## Process

`app.js` connects with `MONGO_URI_PRODUCTION`, serves `public/`, sets the session cookie secret from `SESSION_SECRET`, mounts routers, and listens on port 3000.

| Mount | File | Role |
| --- | --- | --- |
| pages on `app.js` | `app.js` | Home, search, book details, favourites, categories, ratings, Razorpay |
| `/auth` | `routes/auth.js` | Register, login, logout, password reset, block, list users |
| `/books` | `routes/books.js` | Add, edit, delete, profile photo, favourites |
| `/api/mobile` | `routes/mobile.js` | Android JSON API |

`routes/bookCategories.js` is not mounted. Socket.IO is constructed, and the process starts with `app.listen`, so chat events in `public/js/chatJs.js` have no server handler.

## Collections

**User** (`models/User.js`): `name`, unique `email`, bcrypt `password`, `phone`, `profilePic`, `blocked`, `favorites` (Book ids), `mobileCart` (Book ids).

**Book** (`models/Book.js`): `title`, `author`, `publication_year`, `description`, `price`, `publisher`, `language`, `quantity`, `condition` enum, `category`, `image` URL, `user` (seller name string), `userEmail`, `userphn`. Timestamps `created_at`, `updated_at`.

**Rating** (`models/Ratings.js`): `userId`, `username`, `bookId`, `rating`, `review`, `bookimg`.

**Order** (`models/order.js`): `user`, `books[]`, `totalAmount`, Razorpay ids, `status`, `mobileRequestKey`, `mobileTitles`. Written by the mobile API. Not written by website checkout.

## Website flows

**Register.** Browser JSON to `POST /auth/register`. Requires name, email, password, phone. Rejects duplicate email or phone. `bcrypt.hash` with 10 rounds. Saves User. `sendEmail` sends a confirmation.

**Login.** `public/sign_in.js` posts to `POST /auth/login`. Handler loads User by email, rejects `blocked`, `bcrypt.compare`. On success sets `req.session.user` to the user document. A fixed email and password sets `req.session.admin` instead. Logout is `POST /auth/logout` and calls `req.session.destroy`.

**Sell.** `public/add_book.js` calls `GET /books/checkAuthentication`, which uses `isAuthenticated`. The form posts multipart to `POST /books/addbook`. Multer writes `public/uploads`. `uploadOnCloudinary` stores the file and deletes the local copy. Book saves the Cloudinary URL and the session name, email, and phone.

**Browse.** `GET /` loads every Book and every Rating and renders `views/index.ejs`. `GET /search?q=` uses a case-insensitive regex on `title` and `author` and renders `views/searchresults.ejs`. `GET /categories` loads distinct categories, then the books in each one.

**Book page.** `GET /bookdetails?id=` loads one Book and renders `views/bookdetails.ejs`.

**Favourites.** `POST /books/addtofavorites` pushes the book id onto `user.favorites` when it is absent. `GET /favorites` uses `User.findById(id).populate("favorites")`. Removal is `POST /books/removeFromFavorites`.

**Review.** `POST /submit-rating-review` requires a session, rejects a second review for the same user and book, and saves a Rating.

**Cart and pay.** `public/cart.js` keeps the bag in memory. Checkout opens `payment.html?total=`. `POST /create-order` sends `amount * 100` paise to Razorpay. `POST /verify-payment` HMACs `order_id|payment_id` with the Razorpay secret and compares the signature. A match returns success. It does not save an Order or change `quantity`.

**Admin.** `GET /admin` renders counts when `req.session.admin` is set. The page then calls `GET /auth/users/all`, `GET /allBooks`, `POST /auth/users/block`, and `GET /books/deletebook/:id`.

## Mobile API

`routes/mobile.js` exports a router factory. Login and register return a JWT signed for issuer `bookly` and audience `bookly-android`. The token stores a password version so a password change invalidates it. `GET /state` returns books, favourites, cart, and orders. Book create checks a signed image receipt. Delete checks `userEmail`. `POST /orders` runs `session.withTransaction`, requires an `Idempotency-Key`, and saves status `Requested` without taking payment or decrementing stock.

## Interview lines that match the code

- "The page is rendered on the server. Express queries Mongoose and injects the books into EJS."
- "The website is stateful. The session id is the only credential in the browser."
- "The Android client is stateless. It sends `Authorization: Bearer` and uses the same collections."
- "Favourites are ids on the user. `populate` replaces those ids with Book documents before render."
- "Payment authenticity is the HMAC check. The missing piece is pricing the order from book ids and saving it in a transaction."

## Limits to volunteer

- Delete and update in `routes/books.js` do not check the seller.
- `GET /auth/users/all` returns users, including password hashes. `POST /auth/users/block` has no admin check.
- Login copies the full user, including the password hash, into the session. `GET /get-user` returns that object.
- `sendEmail` and `public/newPage.html` contain a mailbox credential in source. Do not read that value aloud.
- Search passes raw input to `RegExp`. Home loads every book and rating. There are no title or author indexes.
- `GET /bookdetails` uses `showDropdown` without declaring it in that handler.
