// Load environment variables
require('dotenv').config();

const { Client } = require('pg');

async function testPostgresConnection() {
  console.log('🔄 Testing PostgreSQL connection...');
  console.log('📍 Database:', process.env.DB_NAME);
  console.log('📍 Host:', process.env.DB_HOST);
  console.log('📍 Port:', process.env.DB_PORT);
  console.log('📍 User:', process.env.DB_USER);
  
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  
  try {
    // Connect to PostgreSQL
    console.log('🔗 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected to PostgreSQL successfully!');
    
    // Test basic query
    console.log('🧪 Testing basic operations...');
    const result = await client.query('SELECT NOW() as current_time, version() as version');
    console.log('✅ Current time:', result.rows[0].current_time);
    console.log('✅ PostgreSQL version:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
    
    // Test creating a simple table
    console.log('🧪 Testing table creation...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS connection_test (
        id SERIAL PRIMARY KEY,
        test_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Test table created successfully');
    
    // Insert test data
    const insertResult = await client.query(
      'INSERT INTO connection_test (test_message) VALUES ($1) RETURNING id',
      ['PostgreSQL connection test successful']
    );
    console.log('✅ Test record inserted with ID:', insertResult.rows[0].id);
    
    // Query test data
    const selectResult = await client.query('SELECT * FROM connection_test WHERE id = $1', [insertResult.rows[0].id]);
    console.log('✅ Test record retrieved:', selectResult.rows[0].test_message);
    
    // Clean up
    await client.query('DELETE FROM connection_test WHERE id = $1', [insertResult.rows[0].id]);
    console.log('🧹 Test record cleaned up');
    
    console.log('🎉 All PostgreSQL tests passed! Database is ready to use.');
    
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('authentication failed')) {
      console.error('💡 Check your username and password in .env file');
    } else if (error.message.includes('database') && error.message.includes('does not exist')) {
      console.error('💡 Database "glass_claims_db" does not exist. Create it first.');
    } else if (error.message.includes('connection refused')) {
      console.error('💡 PostgreSQL server is not running. Start PostgreSQL service.');
    }
  } finally {
    await client.end();
    console.log('🔌 Connection closed');
  }
}

// Run the test
testPostgresConnection().catch(console.error);