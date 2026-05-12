#!/usr/bin/env bash
# NEXUS PRO VPS Comprehensive Audit Script
# Run on VPS: bash audit-nexus.sh > audit-report-$(date +%Y%m%d).txt 2>&1
# READ-ONLY: This script does NOT modify anything.

set +e

print_section() {
  echo ""
  echo "=========================================================="
  echo "  $1"
  echo "=========================================================="
}

print_subsection() {
  echo ""
  echo "--- $1 ---"
}

print_section "NEXUS PRO VPS AUDIT REPORT"
echo "Generated: $(date)"
echo "Hostname: $(hostname)"
echo "Audit Version: 1.0"

# =====================================================
# 1. INFRASTRUCTURE ENGINEER REPORT
# =====================================================
print_section "1. INFRASTRUCTURE (Hardware + OS)"

print_subsection "Operating System"
cat /etc/os-release | grep -E "^(NAME|VERSION|PRETTY_NAME)="
uname -a

print_subsection "CPU"
echo "CPU Model: $(grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)"
echo "CPU Cores: $(nproc)"
echo "CPU Architecture: $(uname -m)"

print_subsection "Memory (RAM)"
free -h

print_subsection "Disk Space"
df -h | grep -v tmpfs | grep -v udev

print_subsection "Disk I/O Health"
which smartctl >/dev/null 2>&1 && {
  for disk in $(lsblk -d -o NAME -n | grep -v loop); do
    echo "--- /dev/$disk ---"
    smartctl -H /dev/$disk 2>/dev/null | grep -E "(SMART|status|result)"
  done
} || echo "smartctl not installed (install with: apt install smartmontools)"

print_subsection "System Uptime"
uptime
echo "Boot time: $(who -b)"

print_subsection "Load Average"
cat /proc/loadavg
echo "(Format: 1min 5min 15min running/total last_pid)"

print_subsection "Kernel Parameters (relevant)"
echo "Max open files: $(cat /proc/sys/fs/file-max)"
echo "TCP max connections: $(cat /proc/sys/net/core/somaxconn)"
echo "Swappiness: $(cat /proc/sys/vm/swappiness)"

# =====================================================
# 2. SECURITY ENGINEER REPORT
# =====================================================
print_section "2. SECURITY"

print_subsection "Firewall Status (ufw)"
which ufw >/dev/null 2>&1 && ufw status verbose || echo "ufw not installed"

print_subsection "Open Ports (listening)"
ss -tlnp 2>/dev/null | head -30

print_subsection "SSH Configuration"
grep -E "^(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)" /etc/ssh/sshd_config 2>/dev/null

print_subsection "Failed Login Attempts (last 24h)"
journalctl _COMM=sshd --since "24 hours ago" 2>/dev/null | grep -i "failed\|invalid" | wc -l
echo "Recent failed logins:"
journalctl _COMM=sshd --since "24 hours ago" 2>/dev/null | grep -i "failed\|invalid" | tail -5

print_subsection "Users on System"
echo "Currently logged in:"
who
echo ""
echo "All users (with shell access):"
grep -E "/bin/(bash|sh|zsh)$" /etc/passwd | cut -d: -f1

print_subsection "Sudo Users"
grep -E "^sudo" /etc/group | cut -d: -f4

print_subsection "Last 10 Logins"
last -n 10 2>/dev/null | head -10

print_subsection "Auto-updates Status"
systemctl is-enabled unattended-upgrades 2>/dev/null || echo "unattended-upgrades not enabled"

# =====================================================
# 3. PERFORMANCE ENGINEER REPORT
# =====================================================
print_section "3. PERFORMANCE (Real-time Usage)"

print_subsection "CPU Usage (current snapshot)"
top -bn1 | head -10

print_subsection "Memory Details"
cat /proc/meminfo | head -10

print_subsection "Top 10 Processes by CPU"
ps aux --sort=-%cpu | head -11

print_subsection "Top 10 Processes by Memory"
ps aux --sort=-%mem | head -11

print_subsection "Network Connections Count"
echo "Established connections: $(ss -t state established 2>/dev/null | wc -l)"
echo "Listening sockets: $(ss -tln 2>/dev/null | wc -l)"

print_subsection "Network Traffic (1 second sample)"
which vnstat >/dev/null 2>&1 && vnstat -tr 1 || echo "vnstat not installed (install with: apt install vnstat)"

# =====================================================
# 4. STORAGE ENGINEER REPORT
# =====================================================
print_section "4. STORAGE (Platform Data)"

print_subsection "Platform Directory Size"
echo "Total size of /root/zekeriya:"
du -sh /root/zekeriya 2>/dev/null || echo "Path not found"

print_subsection "Data Directory Breakdown"
if [ -d "/root/zekeriya/data" ]; then
  ls -lah /root/zekeriya/data/
  echo ""
  echo "File sizes:"
  du -h /root/zekeriya/data/* 2>/dev/null
else
  echo "Data directory does not exist yet"
fi

print_subsection "Node Modules Size"
du -sh /root/zekeriya/node_modules 2>/dev/null || echo "node_modules not found"

print_subsection "Logs Directory Size"
du -sh /var/log 2>/dev/null
echo ""
echo "Largest log files:"
find /var/log -type f -size +10M 2>/dev/null | head -5

print_subsection "PM2 Logs Size"
ls -lah ~/.pm2/logs/ 2>/dev/null || sudo -u nexus ls -lah ~nexus/.pm2/logs/ 2>/dev/null

print_subsection "Disk Inodes Usage"
df -i | grep -v tmpfs | grep -v udev

print_subsection "Backup Status"
echo "Looking for backup files..."
find /root -maxdepth 3 -name "*.tar.gz" -o -name "*.backup" -o -name "*backup*" 2>/dev/null | head -10
echo ""
echo "Cron jobs (looking for backup tasks):"
crontab -l 2>/dev/null | grep -i backup
sudo -u nexus crontab -l 2>/dev/null | grep -i backup

# =====================================================
# 5. NETWORK ENGINEER REPORT
# =====================================================
print_section "5. NETWORK"

print_subsection "Network Interfaces"
ip -br addr show

print_subsection "DNS Resolution Test"
echo "Testing shamcyrpto.com:"
dig +short shamcyrpto.com 2>/dev/null || nslookup shamcyrpto.com 2>/dev/null | grep -A1 "Name:"

print_subsection "nginx Status"
systemctl is-active nginx
nginx -v 2>&1
echo "Active server blocks:"
ls /etc/nginx/sites-enabled/ 2>/dev/null

print_subsection "SSL Certificates"
if [ -d "/etc/letsencrypt/live" ]; then
  for cert in /etc/letsencrypt/live/*/cert.pem; do
    domain=$(basename $(dirname $cert))
    expiry=$(openssl x509 -in $cert -noout -enddate 2>/dev/null | cut -d= -f2)
    echo "$domain: expires $expiry"
  done
else
  echo "No Let's Encrypt certificates found"
fi

print_subsection "Outbound Connectivity Tests"
echo "Binance API: $(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://api.binance.com/api/v3/ping)"
echo "Cloudflare DNS: $(timeout 3 curl -s -o /dev/null -w "%{http_code}" https://1.1.1.1)"
echo "GitHub: $(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://github.com)"

# =====================================================
# 6. SRE REPORT (Services + Reliability)
# =====================================================
print_section "6. SITE RELIABILITY"

print_subsection "PM2 Process Status"
sudo -u nexus pm2 list 2>/dev/null || pm2 list 2>/dev/null || echo "PM2 not accessible"

print_subsection "PM2 Process Details"
sudo -u nexus pm2 info nexus-proxy 2>/dev/null | head -30 || echo "Cannot get PM2 info"

print_subsection "PM2 Restart Count (last 24h)"
sudo -u nexus pm2 list 2>/dev/null | grep -E "(name|restart)"

print_subsection "Active System Services"
systemctl list-units --type=service --state=active | grep -E "(nginx|cloudflared|pm2|nexus|python)" | head -10

print_subsection "Systemd Service Failures (last 24h)"
journalctl --since "24 hours ago" --priority=err 2>/dev/null | tail -20

print_subsection "Recent OOM Kills"
dmesg 2>/dev/null | grep -i "killed process" | tail -5 || journalctl --since "7 days ago" 2>/dev/null | grep -i "killed process" | tail -5

print_subsection "data_server.py Status (Python legacy)"
ps aux | grep "data_server.py" | grep -v grep || echo "data_server.py not running"

print_subsection "nexus_notifier.py Status (Telegram bot)"
ps aux | grep "nexus_notifier" | grep -v grep || echo "nexus_notifier not running"

print_subsection "cloudflared Tunnel Status"
systemctl is-active cloudflared 2>/dev/null || echo "cloudflared not a systemd service"
ps aux | grep cloudflared | grep -v grep | head -3

# =====================================================
# 7. APPLICATION-SPECIFIC CHECKS
# =====================================================
print_section "7. NEXUS PRO APPLICATION HEALTH"

print_subsection "Health Endpoint Response"
curl -s -o /dev/null -w "HTTP: %{http_code} | Time: %{time_total}s\n" --max-time 5 http://localhost:3000/health 2>/dev/null || \
  curl -s -o /dev/null -w "HTTP: %{http_code} | Time: %{time_total}s\n" --max-time 5 http://localhost:3000/api/all 2>/dev/null

print_subsection "API Response Headers"
curl -s -I --max-time 5 http://localhost:3000/api/all 2>/dev/null | head -10

print_subsection "Compression Status"
encoding=$(curl -s -H "Accept-Encoding: gzip" -I http://localhost:3000/api/all 2>/dev/null | grep -i "content-encoding")
echo "Compression: ${encoding:-NOT ENABLED}"

print_subsection "Recent Server Errors (PM2 logs)"
sudo -u nexus pm2 logs nexus-proxy --lines 20 --nostream 2>/dev/null | grep -iE "(error|fail|crash)" | tail -10

print_subsection "Active Push Subscriptions"
if [ -f "/root/zekeriya/data/push-subs.json" ]; then
  count=$(cat /root/zekeriya/data/push-subs.json 2>/dev/null | grep -c "endpoint" || echo "0")
  size=$(stat -c%s /root/zekeriya/data/push-subs.json 2>/dev/null)
  echo "Subscriptions: $count"
  echo "File size: $size bytes"
else
  echo "push-subs.json not found"
fi

print_subsection "Active User Alerts"
if [ -f "/root/zekeriya/data/user-alerts.json" ]; then
  count=$(cat /root/zekeriya/data/user-alerts.json 2>/dev/null | grep -c "ruleType" || echo "0")
  echo "Alerts: $count"
fi

# =====================================================
# 8. SUMMARY AND RECOMMENDATIONS
# =====================================================
print_section "8. AUDIT SUMMARY"

echo "Audit completed at: $(date)"
echo ""
echo "Next steps:"
echo "  1. Save this report"
echo "  2. Share with engineering team for analysis"
echo "  3. Wait for recommendations before making changes"
echo ""
echo "End of audit report."
