const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const qrcodeTerminal = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');
const axios = require('axios');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Add environment variable support
require('dotenv').config();

// Add middleware for parsing form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize user states Map for tracking user sessions
const userStates = new Map();

// Update PayHero API Configuration
const PAYHERO_CONFIG = {
    baseUrl: 'https://backend.payhero.co.ke/api/v2',
    channelId: 852,
    provider: 'm-pesa',
    callbackUrl: 'https://softcash.co.ke/billing/callbackurl.php',
    username: 'BDSblhTccCK4UKI5Tc4d',
    password: 'JkAOJrZwX0IMRAgRCe95GLfDkSWg4qTzJcgVpC76'
};

// Define DataPackage class
class DataPackage {
    constructor(name, price, data, validity, type) {
        this.name = name;
        this.price = price;
        this.data = data;
        this.validity = validity;
        this.type = type;
    }
}

// Define data packages
const data_packages = {
    // Bingwa Data Deals
    'data_1': new DataPackage('1.25GB till midnight @ Ksh 55', 55, "1.25GB", "Until midnight", "Same day data bundle"),
    'data_2': new DataPackage('250MB for 24hrs @ Ksh 18', 18, "250MB", "24 Hours", "Daily data bundle"),
    'data_3': new DataPackage('1GB for 1hr @ Ksh 19', 19, "1GB", "1 Hour", "Hourly data bundle"),
    'data_4': new DataPackage('Internet access for 3hrs @ Ksh 49', 49, "Unlimited", "3 Hours", "Hourly access bundle"),
    'data_5': new DataPackage('1GB for 24hrs @ Ksh 95', 95, "1GB", "24 Hours", "Daily data bundle"),
    'data_6': new DataPackage('350MB for 7 days @ Ksh 47', 47, "350MB", "7 Days", "Weekly data bundle"),
    'data_7': new DataPackage('2GB for 24hrs @ Ksh 100', 100, "2GB", "24 Hours", "Daily data bundle"),
    'data_8': new DataPackage('1.2GB for 30days @ Ksh 250', 250, "1.2GB", "30 Days", "Monthly data bundle"),
    
    // Normal Data Deals
    'data_9': new DataPackage('1GB for 1hr @ Ksh 20', 20, "1GB", "1 Hour", "Hourly data bundle"),
    'data_10': new DataPackage('1.5GB for 3hrs @ Ksh 50', 50, "1.5GB", "3 Hours", "Hourly data bundle"),
    'data_11': new DataPackage('2GB for 24hrs @ Ksh 100', 100, "2GB", "24 Hours", "Daily data bundle")
};

// Database configuration with connection string and enhanced security
const pool = new Pool({
    connectionString: 'postgresql://WIFI_owner:npg_Odvq8Gubl7Ig@ep-noisy-glitter-ab2bd9d6-pooler.eu-west-2.aws.neon.tech/WIFI?sslmode=require',
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 10000, // Increased timeout to 10 seconds
    application_name: 'bingwa_bot', // For monitoring
    statement_timeout: 30000, // 30 seconds timeout for queries
    ssl: {
        rejectUnauthorized: true // Enforce SSL certificate validation
    }
});

// Retry configuration
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

// Function to wait between retries
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to check database connection with retry logic
async function checkDatabaseConnection() {
    let retries = 0;
    
    while (retries < MAX_RETRIES) {
        try {
            const client = await pool.connect();
            try {
                await client.query('SELECT NOW()');
                console.log('Database connection successful');
                // Initialize database tables after successful connection
                await initializeDatabase();
                return true;
            } finally {
                client.release();
            }
        } catch (error) {
            retries++;
            console.error(`Database connection attempt ${retries} failed:`, error.message);
            
            if (retries === MAX_RETRIES) {
                console.error('Max retries reached. Could not connect to database.');
                throw error;
            }
            
            console.log(`Retrying in ${RETRY_DELAY/1000} seconds...`);
            await wait(RETRY_DELAY);
        }
    }
}

// Enhanced security logging
const securityLog = {
    failedConnections: 0,
    suspiciousQueries: 0,
    lastFailedAttempt: null
};

// Database connection error handling
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Performance monitoring
const queryStats = {
    totalQueries: 0,
    slowQueries: 0,
    errors: 0,
    startTime: Date.now()
};

// Function to log query performance
async function logQueryPerformance(query, params, startTime) {
    const duration = Date.now() - startTime;
    queryStats.totalQueries++;
    
    if (duration > 1000) { // Log slow queries (>1s)
        queryStats.slowQueries++;
        console.warn(`Slow query detected (${duration}ms):`, {
            query,
            params,
            duration
        });
    }
}

// Function to check for suspicious queries
function isSuspiciousQuery(query) {
    const suspiciousPatterns = [
        /DROP\s+TABLE/i,
        /DELETE\s+FROM/i,
        /TRUNCATE/i,
        /ALTER\s+TABLE/i,
        /DROP\s+DATABASE/i
    ];
    return suspiciousPatterns.some(pattern => pattern.test(query));
}

// Enhanced query function with security checks and retry logic
async function executeQuery(text, params, retryCount = 0) {
    const startTime = Date.now();
    
    // Security checks
    if (isSuspiciousQuery(text)) {
        securityLog.suspiciousQueries++;
        console.error('Suspicious query detected:', {
            query: text,
            params,
            timestamp: new Date().toISOString()
        });
        throw new Error('Suspicious query detected');
    }

    try {
        const result = await pool.query(text, params);
        await logQueryPerformance(text, params, startTime);
        return result;
    } catch (error) {
        queryStats.errors++;
        securityLog.failedConnections++;
        securityLog.lastFailedAttempt = new Date().toISOString();
        
        // Retry logic for connection errors
        if (retryCount < MAX_RETRIES && 
            (error.message.includes('connection') || 
             error.message.includes('timeout') || 
             error.message.includes('terminated'))) {
            console.log(`Query failed, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
            await wait(RETRY_DELAY);
            return executeQuery(text, params, retryCount + 1);
        }
        
        console.error('Query error:', {
            query: text,
            params,
            error: error.message,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

// Database backup function
async function backupDatabase() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../backups');
    const backupFile = path.join(backupDir, `backup-${timestamp}.sql`);

    // Create backups directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    try {
        // Create backup using pg_dump
        const { stdout, stderr } = await execPromise(
            `pg_dump "postgresql://WIFI_owner:npg_Odvq8Gubl7Ig@ep-noisy-glitter-ab2bd9d6-pooler.eu-west-2.aws.neon.tech/WIFI?sslmode=require" > "${backupFile}"`
        );
        
        console.log(`Database backup created: ${backupFile}`);
        return backupFile;
    } catch (error) {
        console.error('Backup failed:', error);
        throw error;
    }
}

// Database vacuum and analyze function
async function optimizeDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Vacuum analyze all tables
        await client.query('VACUUM ANALYZE');
        
        // Update statistics
        await client.query('ANALYZE');

        await client.query('COMMIT');
        console.log('Database optimization completed');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database optimization failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Function to get database statistics
async function getDatabaseStats() {
    const client = await pool.connect();
    try {
        const stats = await client.query(`
            SELECT
                schemaname,
                relname as table_name,
                n_live_tup as row_count,
                pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) as total_size,
                pg_size_pretty(pg_relation_size(schemaname || '.' || relname)) as table_size,
                pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname) - pg_relation_size(schemaname || '.' || relname)) as index_size
            FROM pg_stat_user_tables
            ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC;
        `);
        return stats.rows;
    } catch (error) {
        console.error('Failed to get database stats:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Function to initialize database tables
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create users table with partitioning
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL,
                username VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                referral_code VARCHAR(10) NOT NULL,
                referred_by INTEGER,
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at);

            -- Create default partition
            CREATE TABLE IF NOT EXISTS users_default PARTITION OF users
            FOR VALUES FROM (MINVALUE) TO (MAXVALUE);

            -- Create a non-partitioned users_id table for foreign key references
            CREATE TABLE IF NOT EXISTS users_id (
                id SERIAL PRIMARY KEY
            );

            -- Create trigger to maintain users_id table
            CREATE OR REPLACE FUNCTION sync_users_id()
            RETURNS TRIGGER AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    INSERT INTO users_id (id) VALUES (NEW.id);
                ELSIF TG_OP = 'DELETE' THEN
                    DELETE FROM users_id WHERE id = OLD.id;
                END IF;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS sync_users_id_trigger ON users;
            CREATE TRIGGER sync_users_id_trigger
            AFTER INSERT OR DELETE ON users
            FOR EACH ROW EXECUTE FUNCTION sync_users_id();
        `);

        // Create transactions table with partitioning
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL,
                user_id INTEGER NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, created_at),
                FOREIGN KEY (user_id) REFERENCES users_id(id)
            ) PARTITION BY RANGE (created_at);

            -- Create default partition
            CREATE TABLE IF NOT EXISTS transactions_default PARTITION OF transactions
            FOR VALUES FROM (MINVALUE) TO (MAXVALUE);
        `);

        // Create referrals table
        await client.query(`
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                referrer_id INTEGER NOT NULL,
                referred_id INTEGER NOT NULL,
                points_earned INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (referrer_id) REFERENCES users_id(id),
                FOREIGN KEY (referred_id) REFERENCES users_id(id)
            );
        `);

        // Create points table with partitioning
        await client.query(`
            CREATE TABLE IF NOT EXISTS points (
                id SERIAL,
                user_id INTEGER NOT NULL,
                points INTEGER NOT NULL,
                type VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id, created_at),
                FOREIGN KEY (user_id) REFERENCES users_id(id)
            ) PARTITION BY RANGE (created_at);

            -- Create default partition
            CREATE TABLE IF NOT EXISTS points_default PARTITION OF points
            FOR VALUES FROM (MINVALUE) TO (MAXVALUE);
        `);

        // Create redemptions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS redemptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                points INTEGER NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                admin_id INTEGER,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users_id(id),
                FOREIGN KEY (admin_id) REFERENCES users_id(id)
            );
        `);

        // Create system_settings table
        await client.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id SERIAL PRIMARY KEY,
                setting_key VARCHAR(50) UNIQUE NOT NULL,
                setting_value TEXT NOT NULL,
                updated_by INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (updated_by) REFERENCES users_id(id)
            );
        `);

        // Create promotional_messages table
        await client.query(`
            CREATE TABLE IF NOT EXISTS promotional_messages (
                id SERIAL PRIMARY KEY,
                message TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                sent_at TIMESTAMP,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users_id(id)
            );

            -- Add index for better performance
            CREATE INDEX IF NOT EXISTS idx_promotional_messages_created_at 
            ON promotional_messages(created_at);
        `);

        // Insert default system settings
        await client.query(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES ('referral_program_active', 'true')
            ON CONFLICT (setting_key) DO NOTHING;
        `);

        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
            CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
            CREATE INDEX IF NOT EXISTS idx_points_user_id ON points(user_id);
            CREATE INDEX IF NOT EXISTS idx_redemptions_user_id ON redemptions(user_id);
            CREATE INDEX IF NOT EXISTS idx_redemptions_status ON redemptions(status);
            
            -- Additional performance indexes
            CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
            CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
            CREATE INDEX IF NOT EXISTS idx_points_created_at ON points(created_at);
            CREATE INDEX IF NOT EXISTS idx_redemptions_created_at ON redemptions(created_at);
        `);

        await client.query('COMMIT');
        console.log('Database tables and indexes created successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database initialization failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Initialize database on startup
(async () => {
    try {
        console.log('Initializing database...');
        await checkDatabaseConnection();
        console.log('Database initialization completed successfully');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1); // Exit if database initialization fails
    }
})();

// Schedule regular maintenance
setInterval(async () => {
    try {
        await optimizeDatabase();
        console.log('Scheduled database optimization completed');
    } catch (error) {
        console.error('Scheduled optimization failed:', error);
    }
}, 24 * 60 * 60 * 1000); // Run every 24 hours

// Schedule regular backups
setInterval(async () => {
    try {
        await backupDatabase();
        console.log('Scheduled database backup completed');
    } catch (error) {
        console.error('Scheduled backup failed:', error);
    }
}, 12 * 60 * 60 * 1000); // Run every 12 hours

// Function to check if session exists
function checkSession() {
    try {
        if (fs.existsSync('./whatsapp-session.json')) {
            console.log('Found existing session file');
            return true;
        }
    } catch (error) {
        console.error('Error checking session file:', error);
    }
    return false;
}

// Function to clear session if needed
function clearSession() {
    try {
        const sessionDir = './.wwebjs_auth';
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log('Session directory cleared');
        }
    } catch (error) {
        console.error('Error clearing session:', error);
    }
}

// Initialize WhatsApp client with session persistence
const client = new Client({
    puppeteer: {
        args: ['--no-sandbox']
    },
    session: {
        path: './.wwebjs_auth',
        dataPath: './.wwebjs_auth'
    }
});

// Add debug logging for client events
client.on('qr', (qr) => {
    console.log('QR Code received, scan with WhatsApp:');
    qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    console.log('Session saved successfully!');
    console.log('Bot is now listening for messages...');
});

client.on('authenticated', (session) => {
    console.log('WhatsApp client is authenticated!');
    console.log('Session saved for future use');
});

client.on('auth_failure', (error) => {
    console.error('Authentication failed:', error);
    console.log('Clearing invalid session...');
    clearSession();
});

client.on('disconnected', (reason) => {
    console.log('Client was disconnected:', reason);
    if (reason === 'LOGOUT') {
        console.log('Clearing session due to logout...');
        clearSession();
    }
});

// Function to generate unique reference
function generateReference() {
    return 'BINGWA-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Function to format phone number
function formatPhoneNumber(number) {
    if (number.startsWith('254')) return `+${number}`;
    if (number.startsWith('0')) return `+254${number.slice(1)}`;
    return number;
}

// Function to initiate STK Push
async function initiateStkPush(amount, phoneNumber) {
    const stkPushUrl = `${PAYHERO_CONFIG.baseUrl}/payments`;
    
    const payload = {
        amount: amount,
        phone_number: formatPhoneNumber(phoneNumber),
        channel_id: PAYHERO_CONFIG.channelId,
        provider: PAYHERO_CONFIG.provider,
        external_reference: 'BINGWA-' + Date.now(),
        callback_url: PAYHERO_CONFIG.callbackUrl
    };

    try {
        const response = await axios.post(stkPushUrl, payload, {
            auth: {
                username: PAYHERO_CONFIG.username,
                password: PAYHERO_CONFIG.password
            },
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('STK Push Response:', response.data);
        return {
            success: true,
            reference: payload.external_reference,
            message: 'Payment initiated successfully'
        };
    } catch (error) {
        console.error('STK Push Error:', error.response?.data || error.message);
        return {
            success: false,
            message: error.response?.data?.message || 'Error initiating payment'
        };
    }
}

// Update points calculation function
function calculateReferralPoints(amount) {
    if (amount < 20) return 0;
    // Calculate points: 5 points for every 20 KES, rounded down
    return Math.floor(amount / 20) * 5;
}

// Add admin phone number constant
const ADMIN_PHONE = '254112735877@c.us';

// Add message event handler with debug logging
client.on('message', async (message) => {
    console.log('Received message:', {
        from: message.from,
        body: message.body,
        type: message.type
    });

    try {
        // Get the message content
        const content = message.body.toLowerCase().trim();
        const sender = message.from;

        console.log('Processing message:', {
            content,
            sender
        });

        // Get user state
        const userState = userStates.get(sender);

        // Handle purchase confirmation first
        if (userState?.state === 'awaiting_purchase_confirmation') {
            if (content === '1') {
                // Ask for payment number
                await message.reply(
                    `*Enter Payment Number* 📱\n\n` +
                    `Please enter the M-PESA number you want to use for payment.\n` +
                    `Format: 254XXXXXXXXX (e.g., 254712345678)\n\n` +
                    `Type "cancel" to cancel the purchase.`
                );
                // Update state to await payment number
                userStates.set(sender, { 
                    state: 'awaiting_payment_number',
                    selectedPackage: userState.selectedPackage
                });
                return;
            } else if (content === '2') {
                // Handle purchase cancellation
                await message.reply('Purchase cancelled. Type "buy" to view packages again.');
                userStates.delete(sender);
                return;
            }
        }

        // Handle payment number input
        if (userState?.state === 'awaiting_payment_number') {
            if (content.toLowerCase() === 'cancel') {
                await message.reply('Purchase cancelled. Type "buy" to view packages again.');
                userStates.delete(sender);
                return;
            }

            // Validate phone number format (accepts multiple Kenyan formats)
            const phoneRegex = /^(?:\+254|254|0)\d{9}$/;
            if (!phoneRegex.test(content)) {
                await message.reply(
                    `*Invalid Phone Number* ❌\n\n` +
                    `Please enter a valid M-PESA number in any of these formats:\n` +
                    `• 254XXXXXXXXX\n` +
                    `• 0XXXXXXXXX\n` +
                    `• +254XXXXXXXXX\n\n` +
                    `Example: 254712345678\n\n` +
                    `Type "cancel" to cancel the purchase.`
                );
                return;
            }

            // Get selected package
            const selectedPackage = data_packages[userState.selectedPackage];
            
            // Initiate STK Push
            const paymentResult = await initiateStkPush(
                selectedPackage.price,
                content
            );

            if (paymentResult.success) {
                await message.reply(
                    `*Payment Initiated!* 🎉\n\n` +
                    `Package: ${selectedPackage.name}\n` +
                    `Amount: Ksh ${selectedPackage.price}\n` +
                    `Payment Number: ${content}\n` +
                    `Reference: ${paymentResult.reference}\n\n` +
                    `Please check your phone for the M-PESA prompt.\n` +
                    `Enter your M-PESA PIN to complete the payment.\n\n` +
                    `Your data bundle will be activated automatically after payment.`
                );
            } else {
                await message.reply(
                    `*Payment Failed* ❌\n\n` +
                    `Sorry, we couldn't initiate the payment.\n` +
                    `Error: ${paymentResult.message}\n\n` +
                    `Please try again or contact support.`
                );
            }
            userStates.delete(sender);
            return;
        }

        // Handle menu selection state
        if (userState?.state === 'viewing_normal_deals') {
            if (/^[1-3]$/.test(content)) {
                // Handle Normal data package purchase
                const packageKey = `data_${parseInt(content) + 8}`; // Convert 1-3 to 9-11
                const selectedPackage = data_packages[packageKey];
                
                if (selectedPackage) {
                    console.log('Processing Normal data package purchase:', selectedPackage.name);
                    await message.reply(
                        `*Selected Package* 📦\n\n` +
                        `Package: ${selectedPackage.name}\n` +
                        `Data: ${selectedPackage.data}\n` +
                        `Validity: ${selectedPackage.validity}\n` +
                        `Type: ${selectedPackage.type}\n` +
                        `Price: Ksh ${selectedPackage.price}\n\n` +
                        '*Confirm Purchase*\n' +
                        '1. Confirm Purchase\n' +
                        '2. Cancel\n\n' +
                        'Reply with 1 to confirm or 2 to cancel.'
                    );
                    // Store selected package in user state
                    userStates.set(sender, { 
                        state: 'awaiting_purchase_confirmation',
                        selectedPackage: packageKey
                    });
                    return;
                }
            }
            userStates.delete(sender);
        }

        if (userState?.state === 'viewing_bingwa_deals') {
            if (/^[1-8]$/.test(content)) {
                // Handle Bingwa data package purchase
                const packageKey = `data_${content}`;
                const selectedPackage = data_packages[packageKey];
                
                if (selectedPackage) {
                    console.log('Processing Bingwa data package purchase:', selectedPackage.name);
                    await message.reply(
                        `*Selected Package* 📦\n\n` +
                        `Package: ${selectedPackage.name}\n` +
                        `Data: ${selectedPackage.data}\n` +
                        `Validity: ${selectedPackage.validity}\n` +
                        `Type: ${selectedPackage.type}\n` +
                        `Price: Ksh ${selectedPackage.price}\n\n` +
                        '*Confirm Purchase*\n' +
                        '1. Confirm Purchase\n' +
                        '2. Cancel\n\n' +
                        'Reply with 1 to confirm or 2 to cancel.'
                    );
                    // Store selected package in user state
                    userStates.set(sender, { 
                        state: 'awaiting_purchase_confirmation',
                        selectedPackage: packageKey
                    });
                    return;
                }
            }
            userStates.delete(sender);
        }

        // Handle main commands
        if (content === 'buy' || content === 'menu') {
            console.log('Sending menu');
            await message.reply(
                '*Bingwa Bot Menu* 📱\n\n' +
                '1. Bingwa Data Deals\n' +
                '2. Normal Data Deals\n' +
                '3. Points - Check your points\n' +
                '4. Refer - Get your referral code\n' +
                '5. Support - Contact support\n' +
                '6. Buy - Show this menu\n\n' +
                'Simply type the number or word to use a command.\n' +
                'Example: Type "1" to view Bingwa Data Deals.'
            );
            return;
        } else if (content === '1' || content === 'bingwa') {
            console.log('Sending Bingwa data packages');
            let bingwaDeals = '*Bingwa Data Deals* 📦\n\n';
            
            // Add Bingwa deals (1-8)
            for (let i = 1; i <= 8; i++) {
                const pkg = data_packages[`data_${i}`];
                bingwaDeals += `${i}. ${pkg.name}\n`;
            }
            
            await message.reply(
                bingwaDeals + '\n' +
                'To purchase, reply with the package number (1-8).\n' +
                'Example: Type "1" to buy 1.25GB till midnight.\n\n' +
                'Type "buy" to go back to main menu.'
            );
            // Set state to viewing Bingwa deals
            userStates.set(sender, { state: 'viewing_bingwa_deals' });
            return;
        } else if (content === '2' || content === 'normal') {
            console.log('Sending Normal data packages');
            let normalDeals = '*Normal Data Deals* 📦\n\n';
            
            // Add Normal deals (9-11)
            for (let i = 9; i <= 11; i++) {
                const pkg = data_packages[`data_${i}`];
                normalDeals += `${i-8}. ${pkg.name}\n`; // Show as 1-3 instead of 9-11
            }
            
            await message.reply(
                normalDeals + '\n' +
                'To purchase, reply with the package number (1-3).\n' +
                'Example: Type "1" to buy 1GB for 1hr.\n\n' +
                'Type "buy" to go back to main menu.'
            );
            // Set state to viewing Normal deals
            userStates.set(sender, { state: 'viewing_normal_deals' });
            return;
        } else if (content === '3' || content === 'points') {
            console.log('Checking points and referrals');
            const userResult = await executeQuery(
                `SELECT u.id, u.username, 
                    (SELECT COALESCE(SUM(points), 0) FROM points WHERE user_id = u.id) as total_points,
                    (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id) as total_referrals,
                    (SELECT COUNT(*) FROM referrals r 
                     JOIN transactions t ON t.user_id = r.referred_id 
                     WHERE r.referrer_id = u.id AND t.status = 'completed') as successful_referrals
                FROM users u 
                WHERE u.phone = $1`,
                [sender]
            );

            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                await message.reply(
                    `*Your Points & Referrals* 🎯\n\n` +
                    `Username: ${user.username}\n` +
                    `Total Points: ${user.total_points}\n` +
                    `Total Referrals: ${user.total_referrals}\n` +
                    `Successful Referrals: ${user.successful_referrals}\n\n` +
                    'Earn points by referring friends!\n' +
                    '• 5 points for KES 20 spent on their FIRST purchase\n' +
                    '• Minimum purchase of KES 20 required\n' +
                    '• Points awarded after successful first purchase\n\n' +
                    '*Redeem Your Points:*\n' +
                    '• 20 points = 250MB for 24 hours\n' +
                    '• Type "redeem" to redeem your points\n' +
                    '• Type "status" to check redemption status\n\n' +
                    'Type "refer" to get your referral code.'
                );
            } else {
                await message.reply(
                    '*Registration Required* 📝\n\n' +
                    'Please register first to view your points.\n' +
                    'Type "register" to start registration.'
                );
            }
            return;
        } else if (content === '4' || content === 'refer') {
            console.log('Getting referral code and stats');
            const result = await executeQuery(
                `SELECT u.referral_code, 
                    (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id) as total_referrals,
                    (SELECT COUNT(*) FROM referrals r 
                     JOIN transactions t ON t.user_id = r.referred_id 
                     WHERE r.referrer_id = u.id AND t.status = 'completed') as successful_referrals,
                    (SELECT COALESCE(SUM(points), 0) FROM points WHERE user_id = u.id) as total_points
                FROM users u 
                WHERE u.phone = $1`,
                [sender]
            );

            if (result.rows.length > 0) {
                const user = result.rows[0];
                await message.reply(
                    `*Your Referral Code* 🎁\n\n` +
                    `Code: ${user.referral_code}\n\n` +
                    `*Referral Stats:*\n` +
                    `Total Referrals: ${user.total_referrals}\n` +
                    `Successful Referrals: ${user.successful_referrals}\n` +
                    `Total Points Earned: ${user.total_points}\n\n` +
                    'Share this code with friends to earn points!\n' +
                    '• 5 points for KES 20 spent on their FIRST purchase\n' +
                    '• Minimum purchase of KES 20 required\n' +
                    '• Points awarded after successful first purchase\n' +
                    '• Only first-time purchases qualify for points'
                );
            } else {
                await message.reply(
                    '*Registration Required* 📝\n\n' +
                    'Please register first to get your referral code.\n' +
                    'Type "register" to start registration.'
                );
            }
            return;
        } else if (content === '5' || content === 'support') {
            console.log('Sending support info');
            await message.reply(
                '*Contact Support* 🆘\n\n' +
                'For assistance, contact:\n' +
                '📞 Phone: +254 123 456 789\n' +
                '📧 Email: support@bingwa.com\n' +
                '⏰ Hours: 24/7\n\n' +
                'Our team is always ready to help!'
            );
            return;
        } else if (content === 'register') {
            console.log('Starting registration');
            await message.reply(
                '*Registration* 📝\n\n' +
                'Please enter your username:'
            );
            // Store user state for registration
            userStates.set(sender, { state: 'awaiting_username' });
            return;
        } else if (content === 'hi' || content === 'hello' || content === 'hey') {
            console.log('Sending greeting response');
            await message.reply(
                '*Welcome to Bingwa Bot!* 👋\n\n' +
                'I can help you buy data bundles and manage your account.\n\n' +
                '*Quick Start Guide:*\n' +
                '1. Type "buy" to see available data packages\n' +
                '2. Select a package by typing its number\n' +
                '3. Confirm your purchase\n' +
                '4. Complete payment via M-PESA\n\n' +
                '*Available Commands:*\n' +
                '• buy - View data packages\n' +
                '• points - Check your points\n' +
                '• refer - Get your referral code\n' +
                '• support - Contact support\n\n' +
                'Type "buy" to get started!'
            );
            return;
        }

        // Handle registration process
        if (userState?.state === 'awaiting_username') {
            // Store username and ask for referral code
            userStates.set(sender, { 
                state: 'awaiting_referral_code',
                username: content
            });
            await message.reply(
                '*Referral Code* 🎁\n\n' +
                'Do you have a referral code?\n\n' +
                '1. Yes, I have a code\n' +
                '2. No, skip this step\n\n' +
                'Reply with 1 or 2.'
            );
            return;
        }

        // Handle referral code response
        if (userState?.state === 'awaiting_referral_code') {
            if (content === '1') {
                userStates.set(sender, { 
                    state: 'awaiting_referral_input',
                    username: userState.username
                });
                await message.reply(
                    '*Enter Referral Code* 🎁\n\n' +
                    'Please enter the referral code:'
                );
                return;
            } else if (content === '2') {
                // Complete registration without referral
                const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                await executeQuery(
                    'INSERT INTO users (username, phone, referral_code) VALUES ($1, $2, $3)',
                    [userState.username, sender, referralCode]
                );
                userStates.delete(sender);
                await message.reply(
                    `*Registration Successful!* 🎉\n\n` +
                    `Username: ${userState.username}\n` +
                    `Your referral code is: ${referralCode}\n\n` +
                    `Share it with friends to earn points!\n` +
                    `Type "buy" to start purchasing data packages.`
                );
                return;
            }
        }

        // Handle referral code input
        if (userState?.state === 'awaiting_referral_input') {
            const referralCode = content.toUpperCase();
            
            // Check if referral code exists
            const referrerResult = await executeQuery(
                'SELECT id FROM users WHERE referral_code = $1',
                [referralCode]
            );

            if (referrerResult.rows.length === 0) {
                await message.reply(
                    '*Invalid Referral Code* ❌\n\n' +
                    'The referral code you entered is invalid.\n' +
                    'Please enter a valid code or type "skip" to continue without a referral.'
                );
                return;
            }

            const referrerId = referrerResult.rows[0].id;
            const userReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

            // Complete registration with referral
            await executeQuery(
                'INSERT INTO users (username, phone, referral_code, referred_by) VALUES ($1, $2, $3, $4)',
                [userState.username, sender, userReferralCode, referrerId]
            );

            userStates.delete(sender);
            await message.reply(
                `*Registration Successful!* 🎉\n\n` +
                `Username: ${userState.username}\n` +
                `Your referral code is: ${userReferralCode}\n\n` +
                `You were referred by a friend!\n` +
                `Share your code to earn points when they make their first purchase.\n` +
                `Type "buy" to start purchasing data packages.`
            );
            return;
        }

        // Only check for first-time user if no commands were handled
        const userResult = await executeQuery(
            'SELECT * FROM users WHERE phone = $1',
            [sender]
        );

        if (userResult.rows.length === 0) {
            // First time user
            await message.reply(
                '*Welcome to Bingwa Bot!* 👋\n\n' +
                'I can help you buy data bundles and manage your account.\n\n' +
                '*Quick Start Guide:*\n' +
                '1. Type "buy" to see available data packages\n' +
                '2. Select a package by typing its number\n' +
                '3. Confirm your purchase\n' +
                '4. Complete payment via M-PESA\n\n' +
                '*Available Commands:*\n' +
                '• buy - View data packages\n' +
                '• points - Check your points\n' +
                '• refer - Get your referral code\n' +
                '• support - Contact support\n\n' +
                'Type "buy" to get started!'
            );
            return;
        }

        // Add admin commands handler
        if (content === 'admin' && userResult.rows[0]?.is_admin) {
            console.log('Admin menu requested');
            await message.reply(
                '*Admin Menu* 👨‍💼\n\n' +
                '1. View All Users\n' +
                '2. View User Spending\n' +
                '3. View Redemption Requests\n' +
                '4. Approve Redemption\n' +
                '5. Reject Redemption\n' +
                '6. View Total Revenue\n' +
                '7. Send Promotional Message\n' +
                '8. Toggle Referral Program\n\n' +
                'Type the number to select an option.'
            );
            userStates.set(sender, { state: 'admin_menu' });
            return;
        }

        // Handle admin menu selections
        if (userState?.state === 'admin_menu') {
            if (content === '1') {
                // View all users
                const usersResult = await executeQuery(
                    `SELECT 
                        u.username, 
                        u.phone, 
                        u.referral_code,
                        COALESCE(r.total_referrals, 0) as total_referrals,
                        COALESCE(t.total_spent, 0) as total_spent,
                        COALESCE(p.total_points, 0) as total_points
                    FROM users u
                    LEFT JOIN (
                        SELECT referrer_id, COUNT(*) as total_referrals 
                        FROM referrals 
                        GROUP BY referrer_id
                    ) r ON r.referrer_id = u.id
                    LEFT JOIN (
                        SELECT user_id, SUM(amount) as total_spent 
                        FROM transactions 
                        WHERE status = 'completed'
                        GROUP BY user_id
                    ) t ON t.user_id = u.id
                    LEFT JOIN (
                        SELECT user_id, SUM(points) as total_points 
                        FROM points 
                        GROUP BY user_id
                    ) p ON p.user_id = u.id
                    ORDER BY u.created_at DESC`
                );

                let userList = '*All Users* 👥\n\n';
                usersResult.rows.forEach((user, index) => {
                    userList += `${index + 1}. ${user.username}\n` +
                               `📱 Phone: ${user.phone}\n` +
                               `🎁 Referral Code: ${user.referral_code}\n` +
                               `👥 Referrals: ${user.total_referrals}\n` +
                               `💰 Total Spent: KES ${user.total_spent}\n` +
                               `🎯 Points: ${user.total_points}\n\n`;
                });

                await message.reply(userList);
                return;
            } else if (content === '2') {
                // View user spending
                const spendingResult = await executeQuery(
                    `SELECT u.username, u.phone,
                        COUNT(t.id) as total_transactions,
                        COALESCE(SUM(t.amount), 0) as total_spent,
                        MAX(t.created_at) as last_purchase
                    FROM users u
                    LEFT JOIN transactions t ON u.id = t.user_id AND t.status = 'completed'
                    GROUP BY u.id, u.username, u.phone
                    ORDER BY total_spent DESC`
                );

                let spendingList = '*User Spending Report* 💰\n\n';
                spendingResult.rows.forEach((user, index) => {
                    spendingList += `${index + 1}. ${user.username}\n` +
                                   `📱 Phone: ${user.phone}\n` +
                                   `💳 Transactions: ${user.total_transactions}\n` +
                                   `💰 Total Spent: KES ${user.total_spent}\n` +
                                   `🕒 Last Purchase: ${user.last_purchase ? new Date(user.last_purchase).toLocaleString() : 'Never'}\n\n`;
                });

                await message.reply(spendingList);
                return;
            } else if (content === '3') {
                // View redemption requests
                const redemptionResult = await executeQuery(
                    `SELECT r.id, r.points, r.status, r.created_at,
                        u.username, u.phone
                    FROM redemptions r
                    JOIN users u ON r.user_id = u.id
                    WHERE r.status = 'pending'
                    ORDER BY r.created_at DESC`
                );

                if (redemptionResult.rows.length === 0) {
                    await message.reply('No pending redemption requests.');
                    return;
                }

                let redemptionList = '*Pending Redemption Requests* ⏳\n\n';
                redemptionResult.rows.forEach((redemption, index) => {
                    redemptionList += `${index + 1}. Request ID: ${redemption.id}\n` +
                                    `👤 User: ${redemption.username}\n` +
                                    `📱 Phone: ${redemption.phone}\n` +
                                    `🎯 Points: ${redemption.points}\n` +
                                    `⏰ Requested: ${new Date(redemption.created_at).toLocaleString()}\n\n` +
                                    `To approve: Type "approve ${redemption.id}"\n` +
                                    `To reject: Type "reject ${redemption.id}"\n\n`;
                });

                await message.reply(redemptionList);
                return;
            } else if (content.startsWith('approve ')) {
                // Approve redemption
                const redemptionId = content.split(' ')[1];
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Get redemption details
                    const redemptionResult = await client.query(
                        `SELECT r.*, u.phone, u.username
                        FROM redemptions r
                        JOIN users u ON r.user_id = u.id
                        WHERE r.id = $1 AND r.status = 'pending'`,
                        [redemptionId]
                    );

                    if (redemptionResult.rows.length === 0) {
                        await message.reply('Invalid redemption request or already processed.');
                        return;
                    }

                    const redemption = redemptionResult.rows[0];

                    // Check if user has enough points
                    const pointsResult = await client.query(
                        `SELECT COALESCE(SUM(points), 0) as total_points 
                        FROM points 
                        WHERE user_id = $1`,
                        [redemption.user_id]
                    );

                    const totalPoints = parseInt(pointsResult.rows[0].total_points);
                    if (totalPoints < redemption.points) {
                        throw new Error('User does not have enough points');
                    }

                    // Update redemption status
                    await client.query(
                        `UPDATE redemptions 
                        SET status = 'approved', 
                            admin_id = (SELECT id FROM users WHERE phone = $1),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2`,
                        [req.session.adminPhone, redemptionId]
                    );

                    // Deduct points by adding a negative points entry
                    await client.query(
                        `INSERT INTO points (user_id, points, type)
                        VALUES ($1, $2, 'redemption')`,
                        [redemption.user_id, -redemption.points]
                    );

                    // Notify user
                    await client.sendMessage(
                        redemption.phone,
                        `*Redemption Approved!* ✅\n\n` +
                        `Your redemption request has been approved.\n` +
                        `You will receive 250MB for 24 hours.\n` +
                        `The data bundle will be activated shortly.\n\n` +
                        `${redemption.points} points have been deducted from your account.\n` +
                        `Remaining points: ${totalPoints - redemption.points}`
                    );

                    await client.query('COMMIT');
                    res.json({ success: true });
                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error('Error approving redemption:', error);
                    res.status(500).json({ success: false, error: error.message });
                } finally {
                    client.release();
                }
                return;
            } else if (content.startsWith('reject ')) {
                // Reject redemption
                const redemptionId = content.split(' ')[1];
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Get redemption details
                    const redemptionResult = await client.query(
                        `SELECT r.*, u.phone, u.username
                        FROM redemptions r
                        JOIN users u ON r.user_id = u.id
                        WHERE r.id = $1 AND r.status = 'pending'`,
                        [redemptionId]
                    );

                    if (redemptionResult.rows.length === 0) {
                        await message.reply('Invalid redemption request or already processed.');
                        return;
                    }

                    const redemption = redemptionResult.rows[0];

                    // Update redemption status
                    await client.query(
                        `UPDATE redemptions 
                        SET status = 'rejected', 
                            admin_id = (SELECT id FROM users WHERE phone = $1),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2`,
                        [req.session.adminPhone, redemptionId]
                    );

                    // Notify user
                    await client.sendMessage(
                        redemption.phone,
                        `*Redemption Rejected* ❌\n\n` +
                        `Your redemption request has been rejected.\n` +
                        `Please contact support for more information.`
                    );

                    await client.query('COMMIT');
                    res.json({ success: true });
                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error('Error rejecting redemption:', error);
                    res.status(500).json({ success: false, error: error.message });
                } finally {
                    client.release();
                }
                return;
            } else if (content === '6') {
                // View total revenue
                const revenueResult = await executeQuery(
                    `SELECT 
                        COUNT(*) as total_transactions,
                        COALESCE(SUM(amount), 0) as total_revenue,
                        COUNT(DISTINCT user_id) as total_customers,
                        AVG(amount) as average_transaction
                    FROM transactions 
                    WHERE status = 'completed'`
                );

                const revenue = revenueResult.rows[0];
                await message.reply(
                    `*Revenue Report* 📊\n\n` +
                    `Total Transactions: ${revenue.total_transactions}\n` +
                    `Total Revenue: KES ${revenue.total_revenue}\n` +
                    `Total Customers: ${revenue.total_customers}\n` +
                    `Average Transaction: KES ${Math.round(revenue.average_transaction)}\n\n` +
                    `Last updated: ${new Date().toLocaleString()}`
                );
                return;
            } else if (content === '7') {
                // Send promotional message
                await message.reply(
                    '*Send Promotional Message* 📢\n\n' +
                    'Please enter the message you want to send to all users.\n' +
                    'The message will be sent immediately.\n\n' +
                    'Type "cancel" to cancel.'
                );
                userStates.set(sender, { state: 'awaiting_promo_message' });
                return;
            } else if (content === '8') {
                // Toggle referral program
                const settingResult = await executeQuery(
                    'SELECT setting_value FROM system_settings WHERE setting_key = $1',
                    ['referral_program_active']
                );
                
                const currentStatus = settingResult.rows[0]?.setting_value === 'true';
                const newStatus = !currentStatus;
                
                await executeQuery(
                    `UPDATE system_settings 
                     SET setting_value = $1, 
                         updated_by = (SELECT id FROM users WHERE phone = $2),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE setting_key = 'referral_program_active'`,
                    [newStatus.toString(), sender]
                );

                await message.reply(
                    `*Referral Program Status Updated* 🔄\n\n` +
                    `The referral program is now ${newStatus ? 'ACTIVE' : 'PAUSED'}.\n\n` +
                    `${newStatus ? 'Users can now earn points from referrals.' : 'Users will not earn points from new referrals until the program is reactivated.'}`
                );
                return;
            }
        }

        // Handle promotional message input
        if (userState?.state === 'awaiting_promo_message') {
            if (content.toLowerCase() === 'cancel') {
                await message.reply('Promotional message cancelled.');
                userStates.delete(sender);
                return;
            }

            // Get all users
            const usersResult = await executeQuery(
                'SELECT phone FROM users'
            );

            // Create promotional message record
            const promoResult = await executeQuery(
                `INSERT INTO promotional_messages (message, created_by)
                 VALUES ($1, (SELECT id FROM users WHERE phone = $2))
                 RETURNING id`,
                [content, sender]
            );

            const promoId = promoResult.rows[0].id;
            let successCount = 0;
            let failCount = 0;

            // Send message to all users
            for (const user of usersResult.rows) {
                try {
                    await client.sendMessage(
                        user.phone,
                        `*Promotional Message* 📢\n\n${content}`
                    );
                    successCount++;
                } catch (error) {
                    console.error('Error sending promotional message:', error);
                    failCount++;
                }
            }

            // Update promotional message status
            await executeQuery(
                `UPDATE promotional_messages 
                 SET status = 'completed', 
                     sent_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [promoId]
            );

            await message.reply(
                `*Promotional Message Sent* ✅\n\n` +
                `Message sent to ${successCount} users.\n` +
                `Failed to send to ${failCount} users.\n\n` +
                `Message ID: ${promoId}`
            );

            userStates.delete(sender);
            return;
        }

        // Update redemption command for users
        if (content === 'redeem') {
            const userResult = await executeQuery(
                `SELECT u.id, u.username, 
                    (SELECT COALESCE(SUM(points), 0) FROM points WHERE user_id = u.id) as total_points
                FROM users u 
                WHERE u.phone = $1`,
                [sender]
            );

            if (userResult.rows.length === 0) {
                await message.reply(
                    '*Registration Required* 📝\n\n' +
                    'Please register first to redeem points.\n' +
                    'Type "register" to start registration.'
                );
                return;
            }

            const user = userResult.rows[0];
            if (user.total_points < 20) {
                await message.reply(
                    '*Insufficient Points* ❌\n\n' +
                    `You need 20 points to redeem.\n` +
                    `Current balance: ${user.total_points} points\n\n` +
                    'Earn more points by referring friends!'
                );
                return;
            }

            // Create redemption request
            const redemptionResult = await executeQuery(
                `INSERT INTO redemptions (user_id, points, status)
                 VALUES ($1, 20, 'pending')
                 RETURNING id`,
                [user.id]
            );

            const redemptionId = redemptionResult.rows[0].id;

            // Notify user
            await message.reply(
                `*Redemption Request Submitted* ✅\n\n` +
                `You have requested to redeem 20 points for 250MB data bundle.\n` +
                `Your request is pending approval.\n` +
                `You will be notified once it's processed.\n\n` +
                `Type "status" to check your redemption status.`
            );

            // Notify admin
            await client.sendMessage(
                ADMIN_PHONE,
                `*New Redemption Request* 🔔\n\n` +
                `Request ID: ${redemptionId}\n` +
                `User: ${user.username}\n` +
                `Phone: ${sender}\n` +
                `Points: 20\n` +
                `Reward: 250MB for 24 hours\n` +
                `Time: ${new Date().toLocaleString()}\n\n` +
                `To approve: Type "approve ${redemptionId}"\n` +
                `To reject: Type "reject ${redemptionId}"\n\n` +
                `Type "admin" to view all pending requests.`
            );
            return;
        }

        // Add status command for users
        if (content === 'status') {
            const statusResult = await executeQuery(
                `SELECT r.status, r.created_at, r.updated_at,
                    CASE 
                        WHEN r.status = 'approved' THEN 'Your data bundle has been activated'
                        WHEN r.status = 'rejected' THEN 'Your request was rejected'
                        WHEN r.status = 'pending' THEN 'Your request is being processed'
                        ELSE 'Unknown status'
                    END as status_message
                FROM redemptions r
                JOIN users u ON r.user_id = u.id
                WHERE u.phone = $1
                ORDER BY r.created_at DESC
                LIMIT 1`,
                [sender]
            );

            if (statusResult.rows.length === 0) {
                await message.reply(
                    '*No Redemption Requests* 📝\n\n' +
                    'You have no pending redemption requests.\n' +
                    'Type "redeem" to redeem your points.'
                );
                return;
            }

            const status = statusResult.rows[0];
            await message.reply(
                `*Redemption Status* 📊\n\n` +
                `Status: ${status.status.toUpperCase()}\n` +
                `Requested: ${new Date(status.created_at).toLocaleString()}\n` +
                `Last Updated: ${new Date(status.updated_at).toLocaleString()}\n\n` +
                `${status.status_message}`
            );
            return;
        }

        // If no command matched, show help
        await message.reply(
            '*Unknown Command* ❓\n\n' +
            'Type "buy" to see available commands and data packages.'
        );

    } catch (error) {
        console.error('Error handling message:', error);
        try {
            await message.reply(
                '*Error Occurred* ❌\n\n' +
                'Sorry, an error occurred. Please try again later or contact support.'
            );
        } catch (replyError) {
            console.error('Error sending error message:', replyError);
        }
    }
});

// Add message status event handler with debug logging
client.on('message_ack', (message, ack) => {
    console.log('Message acknowledgment:', {
        messageId: message.id,
        ack: ack
    });
    if (ack === 3) {
        console.log('Message delivered to recipient');
    }
});

// Add error event handler
client.on('error', (error) => {
    console.error('WhatsApp client error:', error);
});

// Initialize WhatsApp client
client.initialize();

// Update payment callback handler
async function handlePaymentCallback(callbackData) {
    console.log('Payment callback received:', callbackData);
    
    try {
        const { external_reference, status, phone_number, amount } = callbackData;
        
        if (status === 'SUCCESS') {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Get user ID and details
                const userResult = await client.query(
                    'SELECT id, username, referred_by FROM users WHERE phone = $1',
                    [phone_number]
                );
                const userId = userResult.rows[0]?.id;
                const username = userResult.rows[0]?.username;
                const referredBy = userResult.rows[0]?.referred_by;

                if (userId) {
                    // Insert transaction
                    await client.query(
                        `INSERT INTO transactions (user_id, amount, status, reference)
                         VALUES ($1, $2, 'completed', $3)`,
                        [userId, amount, external_reference]
                    );

                    // Check if this is user's first purchase
                    const firstPurchaseResult = await client.query(
                        `SELECT COUNT(*) FROM transactions 
                         WHERE user_id = $1 AND status = 'completed'`,
                        [userId]
                    );
                    const isFirstPurchase = firstPurchaseResult.rows[0].count === '1';

                    if (isFirstPurchase && referredBy && amount >= 20) {
                        // Check if referral program is active
                        const programStatusResult = await client.query(
                            'SELECT setting_value FROM system_settings WHERE setting_key = $1',
                            ['referral_program_active']
                        );
                        
                        const isProgramActive = programStatusResult.rows[0]?.setting_value === 'true';
                        
                        if (!isProgramActive) {
                            console.log('Referral program is paused. No points awarded.');
                            return;
                        }

                        // Check if referrer has already received points for this referral
                        const existingPointsResult = await client.query(
                            `SELECT COUNT(*) FROM points 
                             WHERE user_id = $1 
                             AND type = 'referral' 
                             AND created_at > (
                                 SELECT created_at 
                                 FROM referrals 
                                 WHERE referrer_id = $1 
                                 AND referred_id = $2
                             )`,
                            [referredBy, userId]
                        );
                        
                        const hasReceivedPoints = parseInt(existingPointsResult.rows[0].count) > 0;

                        if (!hasReceivedPoints) {
                        // Calculate points based on amount
                        const points = calculateReferralPoints(amount);
                        
                        if (points > 0) {
                            // Add points to referrer
                            await client.query(
                                `INSERT INTO points (user_id, points, type)
                                 VALUES ($1, $2, 'referral')`,
                                [referredBy, points]
                            );

                            // Get referrer's details
                            const referrerResult = await client.query(
                                'SELECT phone, username FROM users WHERE id = $1',
                                [referredBy]
                            );
                            const referrerPhone = referrerResult.rows[0]?.phone;
                            const referrerUsername = referrerResult.rows[0]?.username;

                            if (referrerPhone) {
                                // Notify referrer about points earned
                                await client.sendMessage(
                                    referrerPhone,
                                    `*Points Earned!* 🎉\n\n` +
                                    `You earned ${points} points from your referral's first purchase!\n` +
                                    `Amount spent: KES ${amount}\n` +
                                    `Points calculation: ${Math.floor(amount / 20)} × 5 points\n` +
                                        `(5 points for every KES 20 spent on their first purchase)\n\n` +
                                    `Type "points" to check your total points.`
                                );
                                }
                            }
                        }
                    }

                    // Notify user about successful purchase
                    await client.sendMessage(
                        phone_number,
                        `*Purchase Successful!* ✅\n\n` +
                        `Your purchase of KES ${amount} has been completed successfully.\n` +
                        `Your data bundle will be activated shortly.\n\n` +
                        `Thank you for using Bingwa Bot!`
                    );

                    // If user was referred, notify them about their referrer
                    if (referredBy) {
                        const referrerResult = await client.query(
                            'SELECT username FROM users WHERE id = $1',
                            [referredBy]
                        );
                        const referrerUsername = referrerResult.rows[0]?.username;

                        await client.sendMessage(
                            phone_number,
                            `*Referral Bonus!* 🎁\n\n` +
                            `You were referred by ${referrerUsername}!\n` +
                            `They earned points from your purchase.\n` +
                            `Share your referral code to earn points too!\n\n` +
                            `Type "refer" to get your referral code.`
                        );
                    }

                    await client.query('COMMIT');
                    console.log('Payment processed successfully:', external_reference);
                }
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } else {
            // Notify user about failed payment
            await client.sendMessage(
                phone_number,
                `*Payment Failed* ❌\n\n` +
                `Your payment of KES ${amount} was not successful.\n` +
                `Please try again or contact support for assistance.\n\n` +
                `Type "support" to get help.`
            );
            console.log('Payment failed:', external_reference);
        }
    } catch (error) {
        console.error('Error processing payment callback:', error);
    }
}

// Set up webhook endpoint for payment callbacks
app.use(express.json());
app.post('/payment-callback', async (req, res) => {
    try {
        await handlePaymentCallback(req.body);
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Start the webhook server
app.listen(port, () => {
    console.log(`Payment webhook server running on port ${port}`);
});

// Update admin portal configuration
const ADMIN_PORTAL_PORT = 3001;
const ADMIN_USERNAME = 'bingwa';
const ADMIN_PASSWORD = 'bingwa123';

// Add local development check
const isLocalDevelopment = process.env.NODE_ENV === 'development';

// Add session management for admin portal
const session = require('express-session');
app.use(session({
    secret: 'bingwa-admin-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Add admin authentication middleware
const adminAuth = (req, res, next) => {
    if (req.session && req.session.admin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
};

// Update admin login route with better error handling
app.get('/admin/login', (req, res) => {
    const error = req.query.error ? 'Invalid username or password' : '';
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Bingwa Sokoni Admin Portal</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    margin: 0; 
                    padding: 20px; 
                    background: #f5f5f5; 
                }
                .login-container { 
                    max-width: 400px; 
                    margin: 50px auto; 
                    background: white; 
                    padding: 30px; 
                    border-radius: 8px; 
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .logo {
                    max-width: 200px;
                    margin-bottom: 15px;
                }
                h1 { 
                    text-align: center; 
                    color: #006400; 
                    margin: 0;
                    font-size: 24px;
                }
                .subtitle {
                    text-align: center;
                    color: #666;
                    margin: 5px 0 20px;
                    font-size: 14px;
                }
                input { 
                    width: 100%; 
                    padding: 12px; 
                    margin: 10px 0; 
                    border: 1px solid #ddd; 
                    border-radius: 4px; 
                    box-sizing: border-box;
                }
                button { 
                    width: 100%; 
                    padding: 12px; 
                    background: #006400; 
                    color: white; 
                    border: none; 
                    border-radius: 4px; 
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: bold;
                }
                button:hover { 
                    background: #004d00; 
                }
                .error { 
                    color: #dc3545; 
                    text-align: center; 
                    margin-bottom: 15px;
                    padding: 10px; 
                    background: #ffe6e6;
                    border-radius: 4px;
                }
                .footer {
                    text-align: center;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                    color: #666;
                    font-size: 12px;
                }
                .agent-info {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 4px; 
                    margin-bottom: 20px; 
                    font-size: 13px;
                    color: #666;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <div class="header">
                    <h1>Bingwa Sokoni Admin Portal</h1>
                    <div class="subtitle">Agent Management System</div>
                    </div>
                
                ${error ? `<div class="error">${error}</div>` : ''}
                
                <form action="/admin/login" method="POST">
                    <input type="text" name="username" placeholder="Username" required>
                    <input type="password" name="password" placeholder="Password" required>
                    <button type="submit">Login</button>
                </form>

                <div class="footer">
                    © ${new Date().getFullYear()} Emmkash Tech. All rights reserved.
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.admin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.redirect('/admin/login?error=1');
    }
});

// Add promotional message route handler
app.post('/admin/promotion/send', adminAuth, async (req, res) => {
    const dbClient = await pool.connect();
    try {
        const { message } = req.body;
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid message format' 
            });
        }

        await dbClient.query('BEGIN');

        // Create promotional message record
        const promoResult = await dbClient.query(
            `INSERT INTO promotional_messages (message, created_by)
             VALUES ($1, (SELECT id FROM users WHERE phone = $2))
             RETURNING id`,
            [message, req.session.adminPhone]
        );

        const promoId = promoResult.rows[0].id;

        // Get all users
        const usersResult = await dbClient.query(
            'SELECT phone FROM users WHERE phone IS NOT NULL'
        );

        let successCount = 0;
        let failCount = 0;
        const errors = [];

        // Send message to all users
        for (const user of usersResult.rows) {
            try {
                if (!user.phone) {
                    console.log('Skipping user with null phone number');
                    continue;
                }

                console.log(`Sending promotional message to ${user.phone}`);
                // Use the WhatsApp client instance
                await client.sendMessage(
                    user.phone + '@c.us', // Add @c.us suffix for WhatsApp
                    `*Promotional Message* 📢\n\n${message}`
                );
                successCount++;
            } catch (error) {
                console.error(`Error sending message to ${user.phone}:`, error);
                failCount++;
                errors.push({
                    phone: user.phone,
                    error: error.message
                });
            }
        }

        // Update promotional message status
        await dbClient.query(
            `UPDATE promotional_messages 
             SET status = 'completed', 
                 sent_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [promoId]
        );

        await dbClient.query('COMMIT');

        res.json({
            success: true,
            messageId: promoId,
            successCount,
            failCount,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error sending promotional message:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        dbClient.release();
    }
});

// Update admin dashboard route with new styling
app.get('/admin/dashboard', adminAuth, async (req, res) => {
    try {
        // Get all users with their IDs
        const usersResult = await executeQuery(
            `SELECT 
                u.id,
                u.username, 
                u.phone, 
                u.referral_code,
                COALESCE(r.total_referrals, 0) as total_referrals,
                COALESCE(t.total_spent, 0) as total_spent,
                COALESCE(p.total_points, 0) as total_points
            FROM users u
            LEFT JOIN (
                SELECT referrer_id, COUNT(*) as total_referrals 
                FROM referrals 
                GROUP BY referrer_id
            ) r ON r.referrer_id = u.id
            LEFT JOIN (
                SELECT user_id, SUM(amount) as total_spent 
                FROM transactions 
                WHERE status = 'completed'
                GROUP BY user_id
            ) t ON t.user_id = u.id
            LEFT JOIN (
                SELECT user_id, SUM(points) as total_points 
                FROM points 
                GROUP BY user_id
            ) p ON p.user_id = u.id
            ORDER BY u.created_at DESC`
        );

        // Get pending redemptions
        const redemptionsResult = await executeQuery(
            `SELECT r.id, r.points, r.status, r.created_at,
                u.username, u.phone
            FROM redemptions r
            JOIN users u ON r.user_id = u.id
            WHERE r.status = 'pending'
            ORDER BY r.created_at DESC`
        );

        // Get revenue stats
        const revenueResult = await executeQuery(
            `SELECT 
                COUNT(*) as total_transactions,
                COALESCE(SUM(amount), 0) as total_revenue,
                COUNT(DISTINCT user_id) as total_customers,
                AVG(amount) as average_transaction
            FROM transactions 
            WHERE status = 'completed'`
        );

        // Get promotional messages
        const promoResult = await executeQuery(
            `SELECT pm.*, u.username as created_by
             FROM promotional_messages pm
             LEFT JOIN users u ON pm.created_by = u.id
             ORDER BY pm.created_at DESC
             LIMIT 10`
        );

        // Get settings
        const settingsResult = await executeQuery(
            'SELECT setting_value FROM system_settings WHERE setting_key = $1',
            ['referral_program_active']
        );

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Bingwa Sokoni Admin Dashboard</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        margin: 0; 
                        padding: 20px; 
                        background: #f5f5f5; 
                    }
                    .container { 
                        max-width: 1200px; 
                        margin: 0 auto; 
                    }
                    .header { 
                        display: flex; 
                        justify-content: space-between; 
                        align-items: center; 
                        margin-bottom: 30px;
                        background: white;
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .header-left {
                        display: flex;
                        align-items: center;
                        gap: 20px;
                    }
                    .logo {
                        height: 40px;
                    }
                    .header h1 {
                        color: #006400;
                        margin: 0;
                    }
                    .stats { 
                        display: grid; 
                        grid-template-columns: repeat(4, 1fr); 
                        gap: 20px; 
                        margin-bottom: 20px; 
                    }
                    .stat-card { 
                        background: white; 
                        padding: 20px; 
                        border-radius: 8px; 
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
                    }
                    .stat-card h3 {
                        color: #006400;
                        margin: 0 0 10px 0;
                    }
                    .stat-card p {
                        font-size: 24px;
                        font-weight: bold;
                        margin: 0;
                        color: #333;
                    }
                    .tabs { 
                        display: flex; 
                        gap: 10px; 
                        margin-bottom: 20px; 
                    }
                    .tab { 
                        padding: 12px 24px; 
                        background: #e9ecef; 
                        border: none; 
                        cursor: pointer;
                        border-radius: 4px;
                        font-weight: bold;
                        color: #666;
                    }
                    .tab.active { 
                        background: #006400; 
                        color: white; 
                    }
                    .content { 
                        background: white; 
                        padding: 20px; 
                        border-radius: 8px; 
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
                    }
                    table { 
                        width: 100%; 
                        border-collapse: collapse; 
                    }
                    th, td { 
                        padding: 12px; 
                        text-align: left; 
                        border-bottom: 1px solid #eee; 
                    }
                    th {
                        background: #f8f9fa;
                        color: #006400;
                    }
                    .action-btn { 
                        padding: 6px 12px; 
                        border: none; 
                        border-radius: 4px; 
                        cursor: pointer;
                        font-weight: bold;
                    }
                    .approve { 
                        background: #006400; 
                        color: white; 
                    }
                    .reject { 
                        background: #FF0000; 
                        color: white; 
                    }
                    .footer {
                        text-align: center;
                        margin-top: 30px;
                        padding: 20px;
                        color: #666;
                        font-size: 12px;
                        background: white;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .logout {
                        color: #FF0000;
                        text-decoration: none;
                        font-weight: bold;
                    }
                    .agent-info {
                        color: #666;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="header-left">
                            <div>
                                <h1>Bingwa Sokoni Admin</h1>
                                <div class="agent-info">Agent: Bingwa Mtaani</div>
                            </div>
                        </div>
                        <a href="/admin/logout" class="logout">Logout</a>
                    </div>
                    
                    <div class="stats">
                        <div class="stat-card">
                            <h3>Total Revenue</h3>
                            <p>KES ${revenueResult.rows[0].total_revenue}</p>
                        </div>
                        <div class="stat-card">
                            <h3>Total Transactions</h3>
                            <p>${revenueResult.rows[0].total_transactions}</p>
                        </div>
                        <div class="stat-card">
                            <h3>Total Customers</h3>
                            <p>${revenueResult.rows[0].total_customers}</p>
                        </div>
                        <div class="stat-card">
                            <h3>Average Transaction</h3>
                            <p>KES ${Math.round(revenueResult.rows[0].average_transaction)}</p>
                        </div>
                    </div>

                    <div class="tabs">
                        <button class="tab active" data-tab="users">Users</button>
                        <button class="tab" data-tab="redemptions">Redemptions</button>
                        <button class="tab" data-tab="promotions">Promotions</button>
                        <button class="tab" data-tab="settings">Settings</button>
                    </div>

                    <div id="users" class="content" style="display: block;">
                        <h2>All Users</h2>
                        <div class="search-box" style="margin-bottom: 20px;">
                            <input type="text" id="userSearch" placeholder="Search by phone number..." style="padding: 8px; width: 300px;">
                            <button class="action-btn approve" onclick="searchUsers()">Search</button>
                            <button class="action-btn" onclick="clearSearch()" style="background: #6c757d;">Clear</button>
                        </div>
                        <div id="searchResults"></div>
                        <table id="usersTable">
                            <tr>
                                <th>Username</th>
                                <th>Phone</th>
                                <th>Referral Code</th>
                                <th>Referrals</th>
                                <th>Total Spent</th>
                                <th>Points</th>
                                <th>Actions</th>
                            </tr>
                            ${usersResult.rows.map(user => `
                                <tr>
                                    <td>${user.username}</td>
                                    <td>${user.phone}</td>
                                    <td>${user.referral_code}</td>
                                    <td>${user.total_referrals}</td>
                                    <td>KES ${user.total_spent}</td>
                                    <td>${user.total_points}</td>
                                    <td>
                                        <button class="action-btn reject" onclick="deleteUser(${user.id}, '${user.username}', '${user.phone}')">Delete</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>

                    <div id="redemptions" class="content" style="display: none;">
                        <h2>Pending Redemptions</h2>
                        <table>
                            <tr>
                                <th>ID</th>
                                <th>User</th>
                                <th>Phone</th>
                                <th>Points</th>
                                <th>Requested</th>
                                <th>Actions</th>
                            </tr>
                            ${redemptionsResult.rows.map(redemption => `
                                <tr>
                                    <td>${redemption.id}</td>
                                    <td>${redemption.username}</td>
                                    <td>${redemption.phone}</td>
                                    <td>${redemption.points}</td>
                                    <td>${new Date(redemption.created_at).toLocaleString()}</td>
                                    <td>
                                        <button class="action-btn approve" onclick="handleRedemption(${redemption.id}, 'approve')">Approve</button>
                                        <button class="action-btn reject" onclick="handleRedemption(${redemption.id}, 'reject')">Reject</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>

                    <div id="promotions" class="content" style="display: none;">
                        <h2>Send Promotional Message</h2>
                        <div class="promo-form">
                            <textarea id="promoMessage" placeholder="Enter your promotional message here..." rows="4" style="width: 100%; margin-bottom: 10px;"></textarea>
                            <button class="action-btn approve" onclick="sendPromotionalMessage()">Send Message</button>
                        </div>
                        <div id="promoStatus" style="margin-top: 10px; display: none;"></div>
                        <h3>Recent Promotional Messages</h3>
                        <table>
                            <tr>
                                <th>ID</th>
                                <th>Message</th>
                                <th>Status</th>
                                <th>Sent At</th>
                                <th>Created By</th>
                            </tr>
                            ${promoResult.rows.map(promo => `
                                <tr>
                                    <td>${promo.id}</td>
                                    <td>${promo.message}</td>
                                    <td>${promo.status}</td>
                                    <td>${promo.sent_at ? new Date(promo.sent_at).toLocaleString() : 'Not sent'}</td>
                                    <td>${promo.created_by}</td>
                                </tr>
                            `).join('')}
                        </table>
                </div>

                    <div id="settings" class="content" style="display: none;">
                        <h2>System Settings</h2>
                        <div class="settings-form">
                            <div class="setting-item">
                                <h3>Referral Program</h3>
                                <p>Current Status: <span id="referralStatus">${settingsResult.rows[0]?.setting_value === 'true' ? 'Active' : 'Paused'}</span></p>
                                <button class="action-btn ${settingsResult.rows[0]?.setting_value === 'true' ? 'reject' : 'approve'}" 
                                        onclick="toggleReferralProgram()">
                                    ${settingsResult.rows[0]?.setting_value === 'true' ? 'Pause Program' : 'Activate Program'}
                                </button>
                            </div>
                            <div class="setting-item">
                                <h3>Database Cleanup</h3>
                                <p>Remove system-generated status@broadcast entries</p>
                                <button class="action-btn reject" onclick="cleanupStatusBroadcast()">Clean Up Database</button>
                            </div>
                        </div>
                    </div>

                    <div class="footer">
                        © ${new Date().getFullYear()} Emmkash Tech. All rights reserved.
                    </div>
                </div>

                <style>
                    .promo-form {
                        margin-bottom: 20px;
                        padding: 20px;
                        background: #f8f9fa;
                        border-radius: 8px;
                    }
                    .promo-form textarea {
                        width: 100%;
                        padding: 12px;
                        margin-bottom: 10px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        resize: vertical;
                    }
                    .settings-form {
                        padding: 20px;
                        background: #f8f9fa;
                        border-radius: 8px;
                    }
                    .setting-item {
                        margin-bottom: 20px;
                        padding: 15px;
                        background: white;
                        border-radius: 4px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    }
                    .setting-item h3 {
                        margin: 0 0 10px 0;
                        color: #006400;
                    }
                    .setting-item p {
                        margin: 0 0 15px 0;
                        color: #666;
                    }
                </style>

                <script>
                    // Tab switching functionality
                    document.addEventListener('DOMContentLoaded', function() {
                        const tabs = document.querySelectorAll('.tab');
                        const contents = document.querySelectorAll('.content');

                        tabs.forEach(tab => {
                            tab.addEventListener('click', function() {
                                // Remove active class from all tabs
                                tabs.forEach(t => t.classList.remove('active'));
                                // Add active class to clicked tab
                                this.classList.add('active');

                                // Hide all content
                                contents.forEach(content => {
                                    content.style.display = 'none';
                                });

                                // Show selected content
                                const tabName = this.getAttribute('data-tab');
                                document.getElementById(tabName).style.display = 'block';
                            });
                        });

                        // Show users tab by default
                        document.getElementById('users').style.display = 'block';
                    });

                    // ... rest of the existing script code ...
                </script>
                <style>
                    .content {
                        padding: 20px;
                        background: white;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    
                    .tab {
                        padding: 12px 24px;
                        background: #e9ecef;
                        border: none;
                        cursor: pointer;
                        border-radius: 4px;
                        font-weight: bold;
                        color: #666;
                        margin-right: 5px;
                    }
                    
                    .tab.active {
                        background: #006400;
                        color: white;
                    }

                    /* ... rest of the existing styles ... */
                </style>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

// Add redemption handling routes
app.post('/admin/redemption/approve/:id', adminAuth, async (req, res) => {
    const redemptionId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get redemption details with additional security checks
        const redemptionResult = await client.query(
            `SELECT r.*, u.phone, u.username,
                (SELECT COUNT(*) FROM redemptions 
                 WHERE user_id = r.user_id 
                 AND status = 'approved' 
                 AND created_at > NOW() - INTERVAL '24 hours') as recent_redemptions,
                (SELECT COUNT(*) FROM redemptions 
                 WHERE user_id = r.user_id 
                 AND status = 'cancelled' 
                 AND created_at > NOW() - INTERVAL '24 hours') as recent_cancellations
            FROM redemptions r
            JOIN users u ON r.user_id = u.id
            WHERE r.id = $1 AND r.status = 'pending'`,
            [redemptionId]
        );

        if (redemptionResult.rows.length === 0) {
            throw new Error('Invalid redemption request or already processed');
        }

        const redemption = redemptionResult.rows[0];

        // Security checks
        if (redemption.recent_redemptions >= 3) {
            throw new Error('User has reached maximum daily redemption limit');
        }

        if (redemption.recent_cancellations >= 5) {
            throw new Error('User has too many recent cancellations');
        }

        // Check if user has enough points
        const pointsResult = await client.query(
            `SELECT COALESCE(SUM(points), 0) as total_points,
                COUNT(*) as total_transactions,
                MAX(created_at) as last_transaction
            FROM points 
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '30 days'`,
            [redemption.user_id]
        );

        const totalPoints = parseInt(pointsResult.rows[0].total_points);
        const totalTransactions = parseInt(pointsResult.rows[0].total_transactions);
        const lastTransaction = pointsResult.rows[0].last_transaction;

        // Additional security checks
        if (totalPoints < redemption.points) {
            throw new Error('User does not have enough points');
        }

        if (totalTransactions < 3) {
            throw new Error('User needs more transaction history');
        }

        if (lastTransaction && (new Date() - new Date(lastTransaction)) < 3600000) {
            throw new Error('Please wait before making another redemption');
        }

        // Update redemption status
        await client.query(
            `UPDATE redemptions 
            SET status = 'approved', 
                admin_id = (SELECT id FROM users WHERE phone = $1),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
            [req.session.adminPhone, redemptionId]
        );

        // Deduct points by adding a negative points entry
        await client.query(
            `INSERT INTO points (user_id, points, type)
            VALUES ($1, $2, 'redemption')`,
            [redemption.user_id, -redemption.points]
        );

        // Notify user
        await client.sendMessage(
            redemption.phone,
            `*Redemption Approved!* ✅\n\n` +
            `Your redemption request has been approved.\n` +
            `You will receive 250MB for 24 hours.\n` +
            `The data bundle will be activated shortly.\n\n` +
            `${redemption.points} points have been deducted from your account.\n` +
            `Remaining points: ${totalPoints - redemption.points}\n\n` +
            `Note: You can redeem up to 3 times per day.`
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error approving redemption:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

app.post('/admin/redemption/reject/:id', adminAuth, async (req, res) => {
    const redemptionId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get redemption details
        const redemptionResult = await client.query(
            `SELECT r.*, u.phone, u.username
            FROM redemptions r
            JOIN users u ON r.user_id = u.id
            WHERE r.id = $1 AND r.status = 'pending'`,
            [redemptionId]
        );

        if (redemptionResult.rows.length === 0) {
            throw new Error('Invalid redemption request or already processed');
        }

        const redemption = redemptionResult.rows[0];

        // Update redemption status
        await client.query(
            `UPDATE redemptions 
            SET status = 'rejected', 
                admin_id = (SELECT id FROM users WHERE phone = $1),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
            [req.session.adminPhone, redemptionId]
        );

        // Notify user
        await client.sendMessage(
            redemption.phone,
            `*Redemption Rejected* ❌\n\n` +
            `Your redemption request has been rejected.\n` +
            `Please contact support for more information.`
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error rejecting redemption:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// Add cancellation route
app.post('/admin/redemption/cancel/:id', adminAuth, async (req, res) => {
    const redemptionId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get redemption details
        const redemptionResult = await client.query(
            `SELECT r.*, u.phone, u.username
            FROM redemptions r
            JOIN users u ON r.user_id = u.id
            WHERE r.id = $1 AND r.status = 'pending'`,
            [redemptionId]
        );

        if (redemptionResult.rows.length === 0) {
            throw new Error('Invalid redemption request or already processed');
        }

        const redemption = redemptionResult.rows[0];

        // Update redemption status to cancelled
        await client.query(
            `UPDATE redemptions 
            SET status = 'cancelled', 
                admin_id = (SELECT id FROM users WHERE phone = $1),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
            [req.session.adminPhone, redemptionId]
        );

        // Notify user
        await client.sendMessage(
            redemption.phone,
            `*Redemption Cancelled* ❌\n\n` +
            `Your redemption request has been cancelled.\n` +
            `No points were deducted.\n\n` +
            `Note: Excessive cancellations may affect your ability to redeem points.`
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error cancelling redemption:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

// Add logout route
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Start admin portal server
app.listen(ADMIN_PORTAL_PORT, () => {
    console.log(`Admin portal running on port ${ADMIN_PORTAL_PORT}`);
});

// Export database functions and pool with security features
module.exports = {
    pool,
    query: executeQuery,
    getClient: () => pool.connect(),
    checkDatabaseConnection,
    initializeDatabase,
    backupDatabase,
    optimizeDatabase,
    getDatabaseStats,
    queryStats,
    securityLog, // Export security log for monitoring
    client
}; 

// Add route handler for toggling referral program status
app.post('/admin/settings/toggle-referral', adminAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get current status
        const currentStatusResult = await client.query(
            'SELECT setting_value FROM system_settings WHERE setting_key = $1',
            ['referral_program_active']
        );
        
        const currentStatus = currentStatusResult.rows[0]?.setting_value === 'true';
        const newStatus = !currentStatus;
        
        // Update status
        await client.query(
            `UPDATE system_settings 
             SET setting_value = $1, 
                 updated_by = (SELECT id FROM users WHERE phone = $2),
                 updated_at = CURRENT_TIMESTAMP
             WHERE setting_key = 'referral_program_active'`,
            [newStatus.toString(), req.session.adminPhone]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            active: newStatus,
            message: `Referral program is now ${newStatus ? 'active' : 'paused'}`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error toggling referral program status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
}); 

// Add cleanup function for status@broadcast entries
async function cleanupStatusBroadcastEntries() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Delete entries where username and phone are 'status@broadcast'
        const result = await client.query(
            `DELETE FROM users 
             WHERE username = 'status@broadcast' 
             AND phone = 'status@broadcast'`
        );

        await client.query('COMMIT');
        console.log(`Successfully removed ${result.rowCount} status@broadcast entries`);
        return result.rowCount;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error cleaning up status@broadcast entries:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Add cleanup route to admin dashboard
app.post('/admin/cleanup/status-broadcast', adminAuth, async (req, res) => {
    try {
        const removedCount = await cleanupStatusBroadcastEntries();
        res.json({
            success: true,
            message: `Successfully removed ${removedCount} status@broadcast entries`
        });
    } catch (error) {
        console.error('Error in cleanup route:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add cleanup button to admin dashboard
app.get('/admin/dashboard', adminAuth, async (req, res) => {
    try {
        // ... existing dashboard code ...

        // Add cleanup button to the settings section
        res.send(`
            <!DOCTYPE html>
            <html>
            <!-- ... existing HTML ... -->
            <div id="settings" class="content" style="display: none;">
                <h2>System Settings</h2>
                <div class="settings-form">
                    <div class="setting-item">
                        <h3>Referral Program</h3>
                        <p>Current Status: <span id="referralStatus">${settingsResult.rows[0]?.setting_value === 'true' ? 'Active' : 'Paused'}</span></p>
                        <button class="action-btn ${settingsResult.rows[0]?.setting_value === 'true' ? 'reject' : 'approve'}" 
                                onclick="toggleReferralProgram()">
                            ${settingsResult.rows[0]?.setting_value === 'true' ? 'Pause Program' : 'Activate Program'}
                        </button>
                    </div>
                    <div class="setting-item">
                        <h3>Database Cleanup</h3>
                        <p>Remove system-generated status@broadcast entries</p>
                        <button class="action-btn reject" onclick="cleanupStatusBroadcast()">Clean Up Database</button>
                    </div>
                </div>
            </div>
            <!-- ... existing HTML ... -->
            <script>
                // ... existing script code ...

                async function cleanupStatusBroadcast() {
                    if (confirm('Are you sure you want to remove all status@broadcast entries? This action cannot be undone.')) {
                        try {
                            const response = await fetch('/admin/cleanup/status-broadcast', {
                                method: 'POST'
                            });
                            
                            if (response.ok) {
                                const result = await response.json();
                                alert(result.message);
                                location.reload();
                            } else {
                                alert('Error cleaning up database');
                            }
                        } catch (error) {
                            alert('Error cleaning up database');
                        }
                    }
                }
            </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

// ... existing code ...

// Add user search and delete routes
app.post('/admin/users/search', adminAuth, async (req, res) => {
    try {
        const { phone } = req.body;
        const result = await executeQuery(
            `SELECT 
                u.id,
                u.username, 
                u.phone, 
                u.referral_code,
                COALESCE(r.total_referrals, 0) as total_referrals,
                COALESCE(t.total_spent, 0) as total_spent,
                COALESCE(p.total_points, 0) as total_points
            FROM users u
            LEFT JOIN (
                SELECT referrer_id, COUNT(*) as total_referrals 
                FROM referrals 
                GROUP BY referrer_id
            ) r ON r.referrer_id = u.id
            LEFT JOIN (
                SELECT user_id, SUM(amount) as total_spent 
                FROM transactions 
                WHERE status = 'completed'
                GROUP BY user_id
            ) t ON t.user_id = u.id
            LEFT JOIN (
                SELECT user_id, SUM(points) as total_points 
                FROM points 
                GROUP BY user_id
            ) p ON p.user_id = u.id
            WHERE u.phone LIKE $1
            ORDER BY u.created_at DESC`,
            [`%${phone}%`]
        );
        res.json({ success: true, users: result.rows });
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/admin/users/delete/:id', adminAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userId = req.params.id;

        // First check if user exists
        const userCheck = await client.query(
            'SELECT id, username, phone FROM users WHERE id = $1',
            [userId]
        );

        if (userCheck.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = userCheck.rows[0];

        // Delete related records in the correct order to maintain referential integrity
        await client.query('DELETE FROM points WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM referrals WHERE referrer_id = $1 OR referred_id = $1', [userId]);
        await client.query('DELETE FROM redemptions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM promotional_messages WHERE created_by = $1', [userId]);
        
        // Finally delete the user
        await client.query('DELETE FROM users WHERE id = $1', [userId]);

        await client.query('COMMIT');

        // Log the deletion
        console.log(`User deleted: ${user.username} (${user.phone})`);

        res.json({ 
            success: true, 
            message: `User ${user.username} (${user.phone}) deleted successfully` 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting user:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to delete user'
        });
    } finally {
        client.release();
    }
});

// Update admin dashboard to include search and delete functionality
app.get('/admin/dashboard', adminAuth, async (req, res) => {
    try {
        // ... existing dashboard code ...

        // Add search and delete functionality to the users section
        const userRows = usersResult.rows.map(user => {
            return '<tr>' +
                '<td>' + escapeHtml(user.username) + '</td>' +
                '<td>' + escapeHtml(user.phone) + '</td>' +
                '<td>' + escapeHtml(user.referral_code) + '</td>' +
                '<td>' + user.total_referrals + '</td>' +
                '<td>KES ' + user.total_spent + '</td>' +
                '<td>' + user.total_points + '</td>' +
                '<td>' +
                '<button class="action-btn reject" onclick="deleteUser(' + user.id + ', \'' + escapeHtml(user.username) + '\', \'' + escapeHtml(user.phone) + '\')">Delete</button>' +
                '</td>' +
                '</tr>';
        }).join('');

        res.send(`
            <!DOCTYPE html>
            <html>
            <!-- ... existing HTML ... -->
            <div id="users" class="content" style="display: block;">
                <h2>All Users</h2>
                <div class="search-box" style="margin-bottom: 20px;">
                    <input type="text" id="userSearch" placeholder="Search by phone number..." style="padding: 8px; width: 300px;">
                    <button class="action-btn approve" onclick="searchUsers()">Search</button>
                    <button class="action-btn" onclick="clearSearch()" style="background: #6c757d;">Clear</button>
                </div>
                <div id="searchResults"></div>
                <table id="usersTable">
                    <tr>
                        <th>Username</th>
                        <th>Phone</th>
                        <th>Referral Code</th>
                        <th>Referrals</th>
                        <th>Total Spent</th>
                        <th>Points</th>
                        <th>Actions</th>
                    </tr>
                    ${userRows}
                </table>
            </div>
            <!-- ... existing HTML ... -->
            <script>
                // ... existing script code ...

                async function searchUsers() {
                    const searchInput = document.getElementById('userSearch');
                    const phone = searchInput.value.trim();
                    
                    if (!phone) {
                        alert('Please enter a phone number to search');
                        return;
                    }

                    try {
                        const response = await fetch('/admin/users/search', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ phone })
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok) {
                            const searchResults = document.getElementById('searchResults');
                            const usersTable = document.getElementById('usersTable');
                            
                            if (result.users.length === 0) {
                                searchResults.innerHTML = '<div style="color: #666; padding: 10px;">No users found</div>';
                                usersTable.style.display = 'none';
                            } else {
                                searchResults.innerHTML = '';
                                usersTable.style.display = 'table';
                                
                                const tbody = usersTable.querySelector('tbody');
                                const rows = result.users.map(user => {
                                    return '<tr>' +
                                        '<td>' + escapeHtml(user.username) + '</td>' +
                                        '<td>' + escapeHtml(user.phone) + '</td>' +
                                        '<td>' + escapeHtml(user.referral_code) + '</td>' +
                                        '<td>' + user.total_referrals + '</td>' +
                                        '<td>KES ' + user.total_spent + '</td>' +
                                        '<td>' + user.total_points + '</td>' +
                                        '<td>' +
                                        '<button class="action-btn reject" onclick="deleteUser(' + user.id + ', \'' + escapeHtml(user.username) + '\', \'' + escapeHtml(user.phone) + '\')">Delete</button>' +
                                        '</td>' +
                                        '</tr>';
                                    }).join('');
                                    tbody.innerHTML = rows;
                                }
                            } else {
                                alert('Error searching users');
                            }
                        } catch (error) {
                            alert('Error searching users');
                        }
                    }

                    function clearSearch() {
                        document.getElementById('userSearch').value = '';
                        document.getElementById('searchResults').innerHTML = '';
                        document.getElementById('usersTable').style.display = 'table';
                        location.reload();
                    }

                    async function deleteUser(userId, username, phone) {
                        if (!userId) {
                            alert('Invalid user ID');
                            return;
                        }

                        if (confirm('Are you sure you want to delete user ' + username + ' (' + phone + ')? This action cannot be undone and will delete all associated data.')) {
                            try {
                                const response = await fetch('/admin/users/delete/' + userId, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    }
                                });
                                
                                const result = await response.json();
                                
                                if (response.ok && result.success) {
                                    alert(result.message);
                                    location.reload();
                                } else {
                                    alert(result.error || 'Error deleting user');
                                }
                            } catch (error) {
                                console.error('Error:', error);
                                alert('Error deleting user: ' + error.message);
                            }
                        }
                    }
                </script>
                <style>
                    .search-box {
                        background: #f8f9fa;
                        padding: 15px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                    }
                    .search-box input {
                        padding: 8px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        margin-right: 10px;
                    }
                    .action-btn {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-weight: bold;
                        margin: 0 5px;
                    }
                    .action-btn.approve {
                        background: #006400;
                        color: white;
                    }
                    .action-btn.reject {
                        background: #dc3545;
                        color: white;
                    }
                </style>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

// ... existing code ...

// Add HTML escaping function
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}