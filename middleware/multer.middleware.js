const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./public/uploads");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extname = path.extname(file.originalname);
    const newFilename = file.fieldname + "-" + uniqueSuffix + extname;
    cb(null, newFilename);
    console.log("Uploaded file name.............:", newFilename);
  },
});

const upload = multer({ storage: storage });

module.exports = upload;
