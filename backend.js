const express = require('express');

const app = express();
const PORT = 4000;

// Hardcoded product data — simulates a real backend the gateway will protect
const products = [
  { id: 1, name: 'Mechanical Keyboard', price: 129.99, category: 'Electronics' },
  { id: 2, name: 'Noise Cancelling Headphones', price: 249.99, category: 'Electronics' },
  { id: 3, name: 'Standing Desk', price: 549.00, category: 'Furniture' },
  { id: 4, name: 'Ultrawide Monitor', price: 399.99, category: 'Electronics' },
  { id: 5, name: 'Ergonomic Chair', price: 449.00, category: 'Furniture' },
];

app.get('/api/products', (req, res) => {
  res.json({ products });
});

app.listen(PORT, () => {
  console.log(`[Backend] Dummy backend running on port ${PORT}`);
});
