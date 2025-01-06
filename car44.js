const Express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require('cors');
const mqtt = require('mqtt');  // Import MQTT
require('dotenv').config();    // Import dotenv to load environment variables

const app = Express();
const server = http.Server(app);

const port = process.env.PORT || 3000;  // Use environment variable for port

const corsOptions = {
  origin: "*",
  methods: ['GET', 'POST']
};

// Store car positions
const carPositions = new Map();

app.use(cors(corsOptions));
app.use(Express.json());

// MQTT Setup
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://34.100.196.132:1883');

mqttClient.on('connect', () => {
  console.log('MQTT client connected.');
  mqttClient.subscribe('sim7600/nmea');  // Subscribe to the NMEA data topic
  mqttClient.subscribe('sim7600/sos');   // Subscribe to SOS alert topic
  mqttClient.subscribe('sim7600/ok');    // Subscribe to OK alert topic
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

  const [rawLat, latDirection, rawLon, lonDirection, , , altitude, speed, course] = parts;

  if (!rawLat || !latDirection || !rawLon || !lonDirection) {
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

// MQTT Message Handler
mqttClient.on('message', (topic, message) => {
  const payload = JSON.parse(message.toString());

  if (topic === 'sim7600/nmea') {
    const { carId, nmea } = payload;

    if (!nmea || !carId) {
      console.warn("Invalid NMEA data received");
      return;
    }

    const parsedData = parseNMEA(nmea);
    if (!parsedData) {
      console.warn("Failed to parse NMEA data");
      return;
    }

    // Directly update the car's position
    const updatedPosition = {
      carId,
      latitude: parsedData.latitude,
      longitude: parsedData.longitude,
      ...parsedData
    };

    carPositions.set(carId, updatedPosition);
    io.emit('locationUpdate', [updatedPosition]);  // Broadcast the update to clients
  }

  if (topic === 'sim7600/sos') {
    const { carId, message } = payload;
    const sosMessage = { carId, message, timestamp: new Date() };
    io.emit('sos', sosMessage);
  }

  if (topic === 'sim7600/ok') {
    const { carId, message } = payload;
    const okMessage = { carId, message, timestamp: new Date() };
    io.emit('ok', [okMessage]);
    console.log("OK status updated", carId);
  }
});

// Socket.IO setup for frontend communication
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ['GET', 'POST']
  },
});

io.on('connection', (socket) => {
  console.log("Client connected:", socket.id);
});

// Start the server
server.listen(port, () => {
  console.log("Server listening on port:", port);
});
