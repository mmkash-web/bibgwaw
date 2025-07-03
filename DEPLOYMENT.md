# Deployment Guide

## VPS Deployment (Ubuntu/Debian)

1. **Initial Setup**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE bingwa_bot;
CREATE USER bingwa_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE bingwa_bot TO bingwa_user;
\q
```

2. **Application Setup**
```bash
# Clone repository
git clone <your-repo-url>
cd bingwa-bot

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your configuration

# Create logs directory
mkdir logs
```

3. **Start Application**
```bash
# Start with PM2
npm run deploy

# Check status
npm run status

# View logs
npm run logs
```

4. **PM2 Commands**
```bash
# Start application
pm2 start ecosystem.config.js

# Stop application
pm2 stop ecosystem.config.js

# Restart application
pm2 restart ecosystem.config.js

# View logs
pm2 logs

# Monitor
pm2 monit

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

## Heroku Deployment

1. **Install Heroku CLI**
```bash
# For Ubuntu/Debian
sudo snap install --classic heroku
```

2. **Login to Heroku**
```bash
heroku login
```

3. **Create Heroku App**
```bash
heroku create your-app-name
```

4. **Add PostgreSQL Add-on**
```bash
heroku addons:create heroku-postgresql:hobby-dev
```

5. **Set Environment Variables**
```bash
heroku config:set NODE_ENV=production
heroku config:set ADMIN_USERNAME=your_admin_username
heroku config:set ADMIN_PASSWORD=your_admin_password
# Add other environment variables as needed
```

6. **Deploy to Heroku**
```bash
git push heroku main
```

7. **Check Logs**
```bash
heroku logs --tail
```

## Important Notes

1. **VPS Security**
   - Always use strong passwords
   - Configure firewall (UFW)
   - Keep system updated
   - Use SSL/TLS for web interface
   - Regular backups

2. **Database Backups**
```bash
# Backup
pg_dump -U bingwa_user bingwa_bot > backup.sql

# Restore
psql -U bingwa_user bingwa_bot < backup.sql
```

3. **Monitoring**
   - Use PM2 monitoring
   - Set up log rotation
   - Monitor system resources
   - Set up alerts for critical issues

4. **Troubleshooting**
   - Check PM2 logs: `pm2 logs`
   - Check system logs: `journalctl -u pm2-root`
   - Check database: `sudo -u postgres psql -d bingwa_bot`
   - Check application status: `pm2 status` 