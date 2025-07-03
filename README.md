# Bingwa Bot - WhatsApp Data Bundle Management System

A WhatsApp bot for managing data bundles, referrals, and points system with an admin dashboard.

## Features

- WhatsApp bot interface for users
- Admin dashboard for management
- Referral system with points
- Data bundle purchases
- Redemption system
- Promotional message broadcasting
- User management
- Transaction tracking

## Prerequisites

- Node.js >= 14.0.0
- PostgreSQL >= 12
- WhatsApp Business API access
- M-PESA API credentials (if applicable)
- VPS or Heroku account for deployment

## Installation

### Local Development

1. Clone the repository:
```bash
git clone <repository-url>
cd bingwa-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
# Application
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bingwa_bot
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password

# Session
SESSION_SECRET=your_session_secret

# WhatsApp
WHATSAPP_CLIENT_ID=your_client_id
WHATSAPP_CLIENT_SECRET=your_client_secret

# M-PESA (if applicable)
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_PASSKEY=your_passkey
MPESA_SHORTCODE=your_shortcode
```

5. Start development server:
```bash
npm run dev
```

## Deployment

### VPS Deployment (Ubuntu/Debian)

1. **System Setup**
```bash
# Update system and install required packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nodejs npm postgresql postgresql-contrib

# Install PM2 globally
sudo npm install -g pm2
```

2. **Application Setup**
```bash
# Create application directory
mkdir ~/apps
cd ~/apps

# Clone repository from GitHub
git clone https://github.com/your-username/bingwa-bot.git
cd bingwa-bot

# Install dependencies
npm install

# Create and configure environment file
cp .env.example .env
nano .env  # Edit with your configuration

# Create logs directory
mkdir logs
```

3. **Database Setup**
```bash
# Access PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE bingwa_bot;
CREATE USER bingwa_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE bingwa_bot TO bingwa_user;
\q
```

4. **Start Application**
```bash
# Start with PM2
npm run deploy

# Save PM2 configuration
pm2 save
pm2 startup
```

5. **Security Setup**
```bash
# Configure firewall
sudo ufw allow 22/tcp  # SSH
sudo ufw allow 3000/tcp  # Application
sudo ufw enable

# Set up SSL (if using domain)
sudo apt install certbot
sudo certbot certonly --standalone -d your-domain.com
```

### Updating the Application

To update the application with the latest changes from GitHub:

```bash
# Navigate to the project directory
cd ~/apps/bingwa-bot

# Pull latest changes
git pull

# Install any new dependencies
npm install

# Restart the application
pm2 restart ecosystem.config.js
```

### Verifying Deployment

```bash
# Check application status
pm2 status

# View application logs
pm2 logs

# Monitor application in real-time
pm2 monit
```

### Heroku Deployment

1. **Install Heroku CLI**
```bash
sudo snap install --classic heroku
```

2. **Deploy to Heroku**
```bash
# Login to Heroku
heroku login

# Create new app
heroku create your-app-name

# Add PostgreSQL
heroku addons:create heroku-postgresql:hobby-dev

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set ADMIN_USERNAME=your_admin_username
heroku config:set ADMIN_PASSWORD=your_admin_password
# Add other environment variables as needed

# Deploy
git push heroku main
```

## Maintenance

### Database Backups

```bash
# Create backup
pg_dump -U bingwa_user bingwa_bot > backup_$(date +%Y%m%d).sql

# Restore from backup
psql -U bingwa_user bingwa_bot < backup.sql
```

### Monitoring

```bash
# Check application status
npm run status

# View logs
npm run logs

# Monitor resources
pm2 monit

# Check system resources
htop
```

### Common Commands

```bash
# Start application
npm run deploy

# Stop application
npm run stop

# Restart application
npm run restart

# View logs
npm run logs

# Check status
npm run status
```

## Troubleshooting

1. **Application Issues**
   - Check PM2 logs: `pm2 logs`
   - Check application logs: `tail -f logs/combined.log`
   - Check system logs: `journalctl -u pm2-root`

2. **Database Issues**
   - Check database connection: `psql -U bingwa_user -d bingwa_bot`
   - Check database logs: `tail -f /var/log/postgresql/postgresql-*.log`

3. **WhatsApp Connection Issues**
   - Check WhatsApp client logs in PM2 logs
   - Verify WhatsApp API credentials
   - Check network connectivity

## Security Recommendations

1. **System Security**
   - Keep system updated
   - Use strong passwords
   - Configure firewall
   - Enable SSL/TLS
   - Regular backups

2. **Application Security**
   - Use environment variables
   - Implement rate limiting
   - Use secure session management
   - Regular security audits

3. **Database Security**
   - Regular backups
   - Use strong passwords
   - Limit database access
   - Monitor database logs

## Support

For support, please contact:
- Email: support@example.com
- WhatsApp: +1234567890

## License

This project is licensed under the MIT License - see the LICENSE file for details. 