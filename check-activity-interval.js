const { Client } = require('pg');

const client = new Client({
  host: '23.95.193.155',
  port: 5432,
  database: 'employee_monitoring',
  user: 'monitoring_user',
  password: 'monitoring_pass_2024'
});

async function checkActivityInterval() {
  try {
    await client.connect();
    console.log('Connected to database');

    const result = await client.query(`
      SELECT
        id,
        "sessionId",
        timestamp,
        "isActive",
        keystrokes,
        "mouseClicks",
        "activityInterval",
        "activeWindowProcess"
      FROM activity_records
      WHERE "activityInterval" IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 10
    `);

    console.log('\n=== Recent Activity Records with activityInterval ===\n');

    result.rows.forEach((row, index) => {
      console.log(`Record ${index + 1}:`);
      console.log(`  ID: ${row.id}`);
      console.log(`  Timestamp: ${row.timestamp}`);
      console.log(`  Is Active: ${row.isActive}`);
      console.log(`  Keystrokes: ${row.keystrokes}`);
      console.log(`  Mouse Clicks: ${row.mouseClicks}`);
      console.log(`  Activity Interval: ${row.activityInterval} ms (${row.activityInterval / 60000} minutes)`);
      console.log(`  Active Window: ${row.activeWindowProcess}`);
      console.log('');
    });

    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkActivityInterval();
