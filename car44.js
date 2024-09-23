const Express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const port = process.env.PORT || 3000;

const app = Express();
const server = http.Server(app);

const corsOptions = {
  origin: "*",
  methods: ['GET', 'POST']
};

// Store car positions
const carPositions = new Map();

app.use(cors(corsOptions));
app.use(Express.json());

const trackCoordinates = [];

// Reading the CSV file containing track coordinates
fs.createReadStream('coordinates1.csv')
  .pipe(csv())
  .on('data', (row) => {
    const lat = parseFloat(row.lat);
    const lng = parseFloat(row.lng);
    trackCoordinates.push({ lat, lng });
  })
  .on('end', () => {
    console.log('CSV file successfully processed.');
  });

// Convert degree format (DMS) to decimal format
function convertToDecimal(degreeString, direction) {
  const degreeLength = direction === 'N' || direction === 'S' ? 2 : 3;
  const degrees = parseInt(degreeString.slice(0, degreeLength));
  const minutes = parseFloat(degreeString.slice(degreeLength));
  let decimal = degrees + (minutes / 60);

  if (direction === 'S' || direction === 'W') {
    decimal = -decimal;
  }

  return decimal;
}

// Parse NMEA string to extract location data
function parseNMEA(nmea) {
  const parts = nmea.split(',');

  if (parts.length < 9) {
    console.warn('Invalid NMEA data: insufficient parts');
    return null;
  }

  const [rawLat, latDirection, rawLon, lonDirection, date, time, altitude, speed, course] = parts;

  if (!rawLat || !latDirection || !rawLon || !lonDirection || !date || !time) {
    console.warn('Invalid NMEA data: missing required fields');
    return null;
  }

  const latitude = convertToDecimal(rawLat, latDirection);
  const longitude = convertToDecimal(rawLon, lonDirection);

  return {
    latitude,
    longitude,
    altitude: parseFloat(altitude),
    speed: parseFloat(speed),
    course: parseFloat(course)
  };
}

// Find the nearest track point to the current position
function findNearestTrackPoint(position) {
  let nearestPoint = trackCoordinates[0];
  let minDistance = Infinity;
  let index = 0;

  for (let i = 0; i < trackCoordinates.length; i++) {
    const point = trackCoordinates[i];
    const distance = Math.sqrt(
      Math.pow(position.latitude - point.lat, 2) + 
      Math.pow(position.longitude - point.lng, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      nearestPoint = point;
      index = i;
    }
  }

  return { point: nearestPoint, index, distance: minDistance };
}

// Check if two positions are equal within a certain threshold
function isPositionEqual(pos1, pos2, threshold = 0.0001) {
  return Math.abs(pos1.latitude - pos2.latitude) < threshold &&
         Math.abs(pos1.longitude - pos2.longitude) < threshold;
}

// Find the car behind the SOS car
function findCarBehind(sosCarId) {
  const sosCar = carPositions.get(sosCarId);
  if (!sosCar) return null;

  const { index: sosCarIndex } = findNearestTrackPoint(sosCar);
  let nearestCarBehind = null;
  let minDistance = Infinity;

  for (const [id, car] of carPositions.entries()) {
    if (id === sosCarId) continue;

    const { index: carIndex } = findNearestTrackPoint(car);
    const distance = (carIndex - sosCarIndex + trackCoordinates.length) % trackCoordinates.length;

    if (distance > 0 && distance < minDistance) {
      minDistance = distance;
      nearestCarBehind = { id, ...car };
    }
  }

  return nearestCarBehind;
}

// Initialize socket connection
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ['GET', 'POST']
  },
});

// Handle track data
app.post('/track', (req, res) => {
  try {
    console.log('Received data from SIM7600E-H:', req.body);

    const { nmea, carId } = req.body;
    if (!nmea || !carId) {
      res.status(400).json({ msg: "Invalid data received" });
      return;
    }

    const parsedData = parseNMEA(nmea);
    if (!parsedData) {
      res.status(400).json({ msg: "Invalid NMEA data" });
      return;
    }

    const currentPosition = carPositions.get(carId);
    const { point: nearestPoint, index: nearestIndex } = findNearestTrackPoint(parsedData);

    if (currentPosition && isPositionEqual(currentPosition, nearestPoint)) {
      res.status(200).json({ msg: "Car position unchanged" });
      return;
    }

    let updatedPosition;
    if (currentPosition) {
      const { index: currentIndex } = findNearestTrackPoint(currentPosition);
      
      // Determine movement direction
      let direction;
      if (nearestIndex === currentIndex) {
        direction = currentPosition.direction || 'forward';
      } else {
        const forwardDistance = (nearestIndex - currentIndex + trackCoordinates.length) % trackCoordinates.length;
        const backwardDistance = (currentIndex - nearestIndex + trackCoordinates.length) % trackCoordinates.length;
        
        if (forwardDistance <= backwardDistance) {
          direction = 'forward';
        } else {
          direction = 'backward';
        }
      }

      // Update position based on direction
      if (direction === 'forward') {
        updatedPosition = {
          ...parsedData,
          latitude: nearestPoint.lat,
          longitude: nearestPoint.lng,
          direction: direction
        };
      } else if (direction === 'backward') {
        // For backward movement, decrement the index to follow the track in reverse
        let prevIndex = (currentIndex - 1 + trackCoordinates.length) % trackCoordinates.length;

        // Loop backward until reaching the nearest point
        while (prevIndex !== nearestIndex) {
          prevIndex = (prevIndex - 1 + trackCoordinates.length) % trackCoordinates.length;
        }

        const prevPoint = trackCoordinates[prevIndex];
        updatedPosition = {
          ...parsedData,
          latitude: prevPoint.lat,
          longitude: prevPoint.lng,
          direction: direction
        };
      }
    } else {
      updatedPosition = {
        ...parsedData,
        latitude: nearestPoint.lat,
        longitude: nearestPoint.lng,
        direction: 'forward'
      };
    }

    const record = { carId, ...updatedPosition };
    carPositions.set(carId, record);  // Update car position
    io.emit('locationUpdate', [record]);
    console.log('Emitted record:', record);
    res.status(200).json({ msg: "Location updated successfully" });
  } catch (err) {
    console.error('Error handling data:', err);
    res.status(500).json({ msg: "Internal Server Error" });
  }
});

// Handle SOS alerts
app.post('/sos', (req, res) => {
  const { carId, message } = req.body;
  const sosMessage = { carId, message, timestamp: new Date() };
  io.emit('sos', sosMessage);

  // Find the car behind and send a warning
  const carBehind = findCarBehind(carId);
  if (carBehind) {
    const warningMessage = {
      carId: carBehind.id,
      message: `Warning: Car ${carId} ahead has sent an SOS alert. Please proceed with caution.`,
      timestamp: new Date()
    };
    io.emit('warning', warningMessage);
  }

  res.status(200).send({ message: 'SOS alert sent successfully' });
});

// Handle OK status
app.post('/ok', (req, res) => {
  const { carId, message } = req.body;
  const okMessage = { carId, message, timeStamp: new Date() };
  io.emit("ok", [okMessage]);
  console.log("OK status updated", carId);
  res.status(200).send([{ okMessage, message: `OK status updated ${carId}` }]);
});

// Socket connection event
io.on('connection', (socket) => {
  console.log("Connected to device", socket.id);
});

// Start the server
server.listen(port, () => {
  console.log("Listening at:", port);
});
