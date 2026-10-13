const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri || uri.includes('<username>') || uri.includes('<password>')) {
    console.error('\n===============================================================');
    console.error(' [FATAL] MONGODB_URI is not configured in backend/.env');
    console.error(' Please configure a valid MongoDB Atlas connection string:');
    console.error(' Example: MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/feedbackhub');
    console.error('===============================================================\n');
    isConnected = false;
    return false;
  }

  try {
    mongoose.connection.on('connected', () => {
      isConnected = true;
      console.log('[MongoDB] Connected successfully to database');
    });

    mongoose.connection.on('error', (err) => {
      isConnected = false;
      console.error('[MongoDB] Connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('[MongoDB] Disconnected from database');
    });

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });

    isConnected = true;
    return true;
  } catch (err) {
    isConnected = false;
    console.error('\n===============================================================');
    console.error(' [FATAL] Failed to connect to MongoDB Atlas:');
    console.error(' ' + err.message);
    console.error(' Ensure your IP is whitelisted in Atlas Network Access and');
    console.error(' that your credentials in MONGODB_URI are correct.');
    console.error('===============================================================\n');
    return false;
  }
}

// Graceful shutdown
async function closeDB() {
  if (isConnected) {
    await mongoose.connection.close();
    isConnected = false;
    console.log('[MongoDB] Connection closed through graceful shutdown');
  }
}

process.on('SIGINT', async () => {
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDB();
  process.exit(0);
});

function isDbConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = {
  connectDB,
  closeDB,
  isDbConnected
};
