// Android API for the existing Bookly models. Website routes remain available.
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const Book = require('../models/Book');
const Order = require('../models/order');
const { placeRequest, cancelRequest } = require('../utils/placeRequest');

module.exports = function mobileApi(options = {}) {
  const secret = options.secret || process.env.SESSION_SECRET;
  if (!secret) throw new Error('Set the existing SESSION_SECRET before enabling the mobile API.');
  const signingKey = crypto.createHmac('sha256', secret).update('bookly-mobile-api-v1').digest('hex');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const oid = id => { if (!/^[a-f\d]{24}$/i.test(String(id))) fail(400, 'Invalid book ID.'); return new mongoose.Types.ObjectId(id); };
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const emailQuery = email => ({ email: new RegExp(`^${escape(email)}$`, 'i') });
  const publicUser = u => ({ id: String(u._id), name: u.name || '', email: u.email || '' });
  const passwordVersion = u => crypto.createHmac('sha256', signingKey).update(u.password || '').digest('hex');
  const tokenFor = u => jwt.sign({ pv: passwordVersion(u) }, signingKey, { subject: String(u._id), issuer: 'bookly', audience: 'bookly-android', expiresIn: '7d' });
  const owns = (book, user) => book.userEmail && book.userEmail.toLowerCase() === user.email.toLowerCase();
  const bookDto = (b, user) => ({ id: String(b._id), title: b.title || '', author: b.author || '', description: b.description || '', category: b.category || 'Others', condition: b.condition || 'good', price: Number(b.price) || 0, originalPrice: 0, sellerId: user && owns(b, user) ? String(user._id) : '', sellerName: b.user || '', sellerEmail: b.userEmail || '', imageUrl: b.image || '', quantity: Number(b.quantity) || 0, available: b.quantity > 0, color: '#476354' });
  const orderDto = o => ({ id: String(o._id), total: o.totalAmount, titles: o.mobileTitles?.length ? o.mobileTitles : o.books.map(x => x.book?.title || 'Removed listing'), createdAt: o.createdAt.toISOString(), status: o.status });

  router.use((req, res, next) => {
    (async () => {
      const header = req.get('Authorization');
      req.mobileUser = null;
      if (!header) return;
      let claim;
      try {
        if (!header.startsWith('Bearer ')) fail(401, 'Please sign in again.');
        claim = jwt.verify(header.slice(7), signingKey, { algorithms: ['HS256'], issuer: 'bookly', audience: 'bookly-android' });
        if (!mongoose.isValidObjectId(claim.sub)) fail(401, 'Please sign in again.');
      } catch { fail(401, 'Please sign in again.'); }
      // Database failures must remain server errors, not invalidate a valid session.
      const user = await User.findById(claim.sub);
      if (!user || user.blocked || claim.pv !== passwordVersion(user)) fail(401, 'Please sign in again.');
      req.mobileUser = user;
    })().then(() => next(), next);
  });
  const signedIn = (req, res, next) => req.mobileUser ? next() : res.status(401).json({ message: 'Please sign in to continue.' });
  const hits = new Map();
  const limitAuth = (req, res, next) => {
    const now = Date.now();
    const keys = [[`ip:${req.ip}`, 100], [`email:${clean(req.body?.email, 254).toLowerCase()}`, 12]];
    for (const [key, limit] of keys) {
      const item = hits.get(key);
      const count = item && item.until > now ? item.count + 1 : 1;
      const until = item && item.until > now ? item.until : now + 60000;
      hits.set(key, { count, until });
      if (count > limit) return res.status(429).json({ message: 'Too many attempts. Please wait a minute.' });
    }
    if (hits.size > 10000) for (const key of [...hits.keys()].slice(0, 1000)) hits.delete(key);
    next();
  };
  router.post('/auth/login', limitAuth, asyncRoute(async (req, res) => {
    const email = clean(req.body.email, 254);
    const password = req.body.password;
    if (!email || typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) fail(400, 'Enter your email and password.');
    const user = await User.findOne(emailQuery(email));
    if (!user || user.blocked || !await bcrypt.compare(password, user.password || '')) fail(401, 'Email or password is incorrect.');
    res.json({ token: tokenFor(user), user: publicUser(user) });
  }));
  router.post('/auth/register', limitAuth, asyncRoute(async (req, res) => {
    const name = clean(req.body.name, 80), email = clean(req.body.email, 254).toLowerCase(), phone = clean(req.body.phone, 20);
    const password = req.body.password;
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[\d ()-]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) fail(400, 'Enter a name, valid email, and phone number.');
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) fail(400, 'Use a password of at least 8 characters and at most 72 bytes.');
    if (await User.exists({ $or: [emailQuery(email), { phone }] })) fail(409, 'An account already uses this email or phone.');
    const user = await User.create({ name, email, phone, password: await bcrypt.hash(password, 10) });
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) });
  }));
  router.get('/state', asyncRoute(async (req, res) => {
    const user = req.mobileUser;
    const books = await Book.find().sort({ created_at: -1 }).lean();
    const orders = user ? await Order.find({ user: user._id }).sort({ createdAt: -1 }).populate('books.book').lean() : [];
    res.json({ books: books.map(b => bookDto(b, user)), user: user ? publicUser(user) : null, favorites: user ? user.favorites.map(String) : [], cart: user ? user.mobileCart.map(String) : [], orders: orders.map(orderDto) });
  }));
  router.put('/favorites/:id', signedIn, asyncRoute(async (req, res) => {
    const id = oid(req.params.id);
    if (!await Book.exists({ _id: id })) fail(404, 'This book was removed.');
    await User.updateOne({ _id: req.mobileUser._id }, [{ $set: { favorites: { $cond: [{ $in: [id, { $ifNull: ['$favorites', []] }] }, { $setDifference: ['$favorites', [id]] }, { $concatArrays: [{ $ifNull: ['$favorites', []] }, [id]] }] } } }]);
    res.sendStatus(204);
  }));
  router.put('/cart/:id', signedIn, asyncRoute(async (req, res) => {
    const id = oid(req.params.id), book = await Book.findById(id);
    if (!book || !(book.quantity > 0)) fail(409, 'This book is unavailable.');
    if (owns(book, req.mobileUser)) fail(400, 'You cannot request your own book.');
    await User.updateOne({ _id: req.mobileUser._id }, { $addToSet: { mobileCart: id } });
    res.sendStatus(204);
  }));
  router.delete('/cart/:id', signedIn, asyncRoute(async (req, res) => {
    await User.updateOne({ _id: req.mobileUser._id }, { $pull: { mobileCart: oid(req.params.id) } });
    res.sendStatus(204);
  }));

  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 }, fileFilter(req, file, cb) { cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)); } });
  const sendImage = options.uploadImage || (buffer => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'bookly-mobile', resource_type: 'image' }, (err, result) => err ? reject(err) : resolve(result.secure_url));
    stream.end(buffer);
  }));
  router.post('/uploads', signedIn, upload.single('image'), asyncRoute(async (req, res) => {
    if (!req.file) fail(400, 'Choose a JPEG, PNG, or WebP photo under 5 MB.');
    if (!options.uploadImage && (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET)) fail(503, 'Book photos are temporarily unavailable.');
    let buffer;
    try { buffer = await sharp(req.file.buffer, { limitInputPixels: 25000000 }).rotate().resize(1400, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); }
    catch { fail(400, 'This photo could not be opened. Choose another image.'); }
    const imageUrl = await sendImage(buffer);
    // A receipt prevents clients from submitting arbitrary remote image URLs.
    const receipt = jwt.sign({ imageUrl }, signingKey, { subject: String(req.mobileUser._id), audience: 'bookly-cover', expiresIn: '30m' });
    res.json({ imageUrl, receipt });
  }));
  router.post('/books', signedIn, asyncRoute(async (req, res) => {
    const b = req.body;
    const title = clean(b.title, 150), author = clean(b.author, 120), publisher = clean(b.publisher, 120), language = clean(b.language, 60);
    const price = b.price, quantity = b.quantity, year = b.publicationYear;
    if (!title || !author || !publisher || !language || !['Fiction', 'Non-Fiction', 'text-Books', 'Others'].includes(b.category) || !['like new', 'good', 'fair', 'poor'].includes(b.condition)) fail(400, 'Complete the book details.');
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 1 || price > 100000 || !Number.isInteger(quantity) || quantity < 1 || quantity > 999 || !Number.isInteger(year) || year < 1000 || year > 2100) fail(400, 'Check the price, year, and quantity.');
    let image;
    try {
      const receipt = jwt.verify(b.imageReceipt, signingKey, { algorithms: ['HS256'], audience: 'bookly-cover' });
      if (receipt.sub !== String(req.mobileUser._id) || receipt.imageUrl !== b.imageUrl) throw new Error();
      image = receipt.imageUrl;
    } catch { fail(400, 'Please choose and upload your cover photo again.'); }
    const user = req.mobileUser;
    const book = await Book.create({ title, author, description: clean(b.description, 2000), publisher, language, publication_year: year, category: b.category, condition: b.condition, price: Math.round(price * 100) / 100, quantity, image, user: user.name, userEmail: user.email, userphn: user.phone });
    res.status(201).json(bookDto(book, user));
  }));
  router.delete('/books/:id', signedIn, asyncRoute(async (req, res) => {
    const book = await Book.findById(oid(req.params.id));
    if (!book) fail(404, 'This listing was already removed.');
    if (!owns(book, req.mobileUser)) fail(403, 'Only the seller can remove this listing.');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Book.deleteOne({ _id: book._id, userEmail: book.userEmail }, { session });
        await User.updateMany({}, { $pull: { favorites: book._id, mobileCart: book._id } }, { session });
      });
    } finally { await session.endSession(); }
    // Keep Cloudinary images because website listings may share an asset.
    res.sendStatus(204);
  }));
  router.post('/orders', signedIn, asyncRoute(async (req, res) => {
    const user = await User.findById(req.mobileUser._id);
    const { order, replay } = await placeRequest({
      buyer: user,
      bookIds: user.mobileCart,
      idempotencyKey: req.get('Idempotency-Key'),
      clearCart: true,
    });
    const populated = await Order.findById(order._id).populate('books.book');
    res.status(replay ? 200 : 201).json(orderDto(populated));
  }));
  router.post('/orders/:id/cancel', signedIn, asyncRoute(async (req, res) => {
    const order = await cancelRequest({ buyer: req.mobileUser, orderId: req.params.id });
    const populated = await Order.findById(order._id).populate('books.book');
    res.json(orderDto(populated));
  }));
  router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ message: 'Choose one photo under 5 MB.' });
    if (err.code === 11000) return res.status(409).json({ message: 'This account or request already exists.' });
    if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
    console.error('Bookly mobile API:', err.name);
    res.status(500).json({ message: 'Bookly could not complete this action. Please retry.' });
  });
  return router;
};
