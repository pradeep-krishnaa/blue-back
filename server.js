const express = require('express');
const app = express();
const port = 3000;

// Middleware to parse JSON
app.use(express.json());

// Sample GET route
app.get('/login', (req, res) => {
  res.json({ message: 'logiinnn' });
  console.log(`Get request`);
});


// Sample POST route
app.post('/data', (req, res) => {
  const receivedData = req.body;
  console.log('Received JSON:', receivedData);

  // Example verification
  if (receivedData.name && receivedData.age) {
    res.status(200).json({ status: 'success', data: receivedData });
  } else {
    res.status(400).json({ status: 'error', message: 'Missing name or age' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
