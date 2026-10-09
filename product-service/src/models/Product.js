const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    // Flexible key/value attributes (color, size, storage, ...)
    attributes: { type: Map, of: String, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
