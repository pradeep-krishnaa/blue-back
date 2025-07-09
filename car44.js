const Express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require('cors');
const mqtt = require('mqtt'); 
require('dotenv').config();    

const app = Express();
const server = http.Server(app);

const port = process.env.PORT || 3002;

const corsOptions = {
  origin: "*",
  methods: ['GET', 'POST']
};

const carPositions = new Map();

app.use(cors(corsOptions));
app.use(Express.json());

// const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883');
const mqttClient = mqtt.connect('mqtt://test.mosquitto.org');



mqttClient.on('connect', () => {
  console.log('MQTT client connected.');
  mqttClient.subscribe('sim7600/nmea');  // Subscribe to the NMEA data topic
  mqttClient.subscribe('sim7600/sos');   // Subscribe to SOS alert topic
  mqttClient.subscribe('sim7600/ok');    // Subscribe to OK alert topic
});


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

function parseDate(dateString) {
  const day = dateString.slice(0, 2);
  const month = dateString.slice(2, 4);
  const year = dateString.slice(4, 6);
  return `20${year}-${month}-${day}`;
}

function parseTime(timeString) {
  const hours = timeString.slice(0, 2);
  const minutes = timeString.slice(2, 4);
  const seconds = timeString.slice(4);
  return `${hours}:${minutes}:${seconds}`;
}


function isValidNMEA(parts) {
  if (parts.length < 9) {
    return false;
  }

  const [rawLat, latDirection, rawLon, lonDirection, date, time] = parts;

  if (!rawLat || !latDirection || !rawLon || !lonDirection || !date || !time) {
    return false;
  }

  if (!/^\d{2}\d+\.\d+$/.test(rawLat) || !/^[NS]$/.test(latDirection)) {
    return false;
  }

  if (!/^\d{3}\d+\.\d+$/.test(rawLon) || !/^[EW]$/.test(lonDirection)) {
    return false;
  }

  if (!/^\d{6}$/.test(date) || !/^\d{6}\.\d$/.test(time)) {
    return false;
  }

  return true;
}

/* function parseData(data) {
  const parts = data.split(',');

  if (!isValidNMEA(parts)) {
    console.warn('Invalid NMEA data');
    return null;
  }

  const rawLat = parts[0];
  const latDirection = parts[1];
  const rawLon = parts[2];
  const lonDirection = parts[3];
  const date = parts[4];
  const time = parts[5];
  const altitude = parseFloat(parts[6]);
  const speed = parseFloat(parts[7]);
  const course = parseFloat(parts[8]);

  const latitude = convertToDecimal(rawLat, latDirection);
  const longitude = convertToDecimal(rawLon, lonDirection);

  return {
    latitude,
    longitude,
    date: parseDate(date),
    time: parseTime(time),
    altitude,
    speed,
    course
  };
} */
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
  
mqttClient.on('message', (topic, message) => {
  const payload = JSON.parse(message.toString());

  if (topic === 'sim7600/nmea') {
  const { carId, latitude, longitude } = payload;

  if (
    typeof carId === 'undefined' ||
    typeof latitude !== 'number' ||
    typeof longitude !== 'number'
  ) {
    console.warn("❌ Invalid minimal GPS data received:", payload);
    return;
  }

  const updatedPosition = {
    carId,
    latitude,
    longitude
  };

  console.log(`📥 Location from Car ${carId}:`, updatedPosition);

  carPositions.set(carId, updatedPosition);
  io.emit('locationUpdate', [updatedPosition]);

  console.log(`📤 Location emitted for Car ${carId}`);
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