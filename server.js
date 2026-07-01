const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8001;

// Helper to format uptime in days, hours, minutes
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    let parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
}

// Get CPU usage times (idle vs active)
function getCpuTimes() {
    const cpus = os.cpus();
    if (!cpus || cpus.length === 0) return { idle: 0, total: 0 };
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    }
    const total = user + nice + sys + idle + irq;
    return { idle, total };
}

// Measure CPU load percentage over a short delay
function getCpuUsage(callback) {
    const start = getCpuTimes();
    setTimeout(() => {
        const end = getCpuTimes();
        const idleDiff = end.idle - start.idle;
        const totalDiff = end.total - start.total;
        const pct = totalDiff === 0 ? 0 : 100 * (1 - idleDiff / totalDiff);
        callback(pct);
    }, 150);
}

// Convert Hex IP address format from /proc/net/tcp
function parseHexIP(hex) {
    if (!hex) return 'unknown';
    if (hex.length === 8) {
        // IPv4 (little-endian hex)
        return [
            parseInt(hex.slice(6, 8), 16),
            parseInt(hex.slice(4, 6), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(0, 2), 16)
        ].join('.');
    }
    // Simplification for IPv6 or raw hex
    return hex;
}

// Get active TCP listening ports from host Linux proc system, or Windows netstat fallback
function getListeningPorts() {
    const portsMap = new Map();
    const isLinux = os.platform() === 'linux';

    if (isLinux) {
        // Paths inside container (mounted from host) or fallback to local proc
        const tcpFiles = [
            { path: '/host/proc/net/tcp', version: 'IPv4' },
            { path: '/proc/net/tcp', version: 'IPv4' },
            { path: '/host/proc/net/tcp6', version: 'IPv6' },
            { path: '/proc/net/tcp6', version: 'IPv6' }
        ];

        for (const file of tcpFiles) {
            try {
                if (fs.existsSync(file.path)) {
                    const content = fs.readFileSync(file.path, 'utf8');
                    const lines = content.split('\n');
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        const parts = line.split(/\s+/);
                        // State '0A' is TCP_LISTEN
                        if (parts[3] === '0A') {
                            const localAddr = parts[1];
                            const [ipHex, portHex] = localAddr.split(':');
                            const port = parseInt(portHex, 16);
                            const ip = parseHexIP(ipHex);

                            // Prefer IPv4 mappings and avoid duplicates
                            const key = `${ip}:${port}`;
                            if (!portsMap.has(port)) {
                                portsMap.set(port, { ip, port, status: 'ONLINE', protocol: 'TCP' });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Error parsing TCP file ${file.path}:`, e.message);
            }
        }
    } else if (os.platform() === 'win32') {
        // Windows netstat parsing for developer local test
        try {
            const output = execSync('netstat -ano', { encoding: 'utf8' });
            const lines = output.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('TCP') && trimmed.includes('LISTENING')) {
                    const parts = trimmed.split(/\s+/);
                    const localAddr = parts[1]; // e.g. "127.0.0.1:8001" or "[::]:8001"
                    const lastColon = localAddr.lastIndexOf(':');
                    if (lastColon !== -1) {
                        const ip = localAddr.slice(0, lastColon).replace('[', '').replace(']', '');
                        const port = parseInt(localAddr.slice(lastColon + 1), 10);
                        if (!portsMap.has(port)) {
                            portsMap.set(port, { ip, port, status: 'ONLINE', protocol: 'TCP' });
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error running netstat on Windows:', e.message);
        }
    }

    return Array.from(portsMap.values());
}

// Parse domains and reverse_proxy ports from Caddyfile configuration
function parseCaddyfile(content) {
    const proxies = [];
    const lines = content.split('\n');
    let currentDomain = '';

    for (let line of lines) {
        line = line.trim();
        // Ignore empty lines and comments
        if (!line || line.startsWith('#')) continue;

        if (line.includes('reverse_proxy')) {
            const parts = line.split(/\s+/);
            const proxyIdx = parts.indexOf('reverse_proxy');
            if (proxyIdx !== -1 && parts[proxyIdx + 1]) {
                const target = parts[proxyIdx + 1].trim(); // e.g. "localhost:8080" or "127.0.0.1:8000"
                const portMatch = target.match(/:(\d+)$/);
                const port = portMatch ? parseInt(portMatch[1], 10) : null;
                if (port && currentDomain) {
                    proxies.push({
                        domain: currentDomain,
                        port: port,
                        target: target
                    });
                }
            }
        } else if (line.endsWith('{')) {
            // Start of a domain block
            currentDomain = line.slice(0, -1).trim();
        } else if (line === '}') {
            currentDomain = '';
        } else if (!line.includes(' ') && !line.includes('{') && !line.includes('}')) {
            // Single-line block declaration fallback
            currentDomain = line;
        }
    }
    return proxies;
}

// Read Caddyfile from host volume or local paths
function getCaddyProxies() {
    const caddyfilePaths = [
        '/host/etc/caddy/Caddyfile',
        '/etc/caddy/Caddyfile',
        './Caddyfile' // local test fallback
    ];

    for (const filePath of caddyfilePaths) {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                return parseCaddyfile(content);
            }
        } catch (e) {
            console.error(`Error reading Caddyfile at ${filePath}:`, e.message);
        }
    }
    return [];
}

// Serve public directory
app.use(express.static(path.join(__dirname)));

// Endpoint for actual server status and port mapping
app.get('/api/status', (req, res) => {
    // 1. Get host memory info
    let memTotal = os.totalmem();
    let memFree = os.freemem();

    // Check host meminfo mount if available
    try {
        const meminfoPath = fs.existsSync('/host/proc/meminfo') ? '/host/proc/meminfo' : '/proc/meminfo';
        if (fs.existsSync(meminfoPath)) {
            const meminfo = fs.readFileSync(meminfoPath, 'utf8');
            const totalMatch = meminfo.match(/^MemTotal:\s+(\d+)/m);
            const availMatch = meminfo.match(/^MemAvailable:\s+(\d+)/m);
            if (totalMatch && availMatch) {
                memTotal = parseInt(totalMatch[1], 10) * 1024; // convert kB to bytes
                memFree = parseInt(availMatch[1], 10) * 1024;
            }
        }
    } catch (e) {
        console.error('Error reading memory info:', e.message);
    }

    const memUsed = memTotal - memFree;
    const ramPercent = ((memUsed / memTotal) * 100).toFixed(1);

    // 2. Get host system uptime
    let uptime = os.uptime();
    try {
        const uptimePath = fs.existsSync('/host/proc/uptime') ? '/host/proc/uptime' : '/proc/uptime';
        if (fs.existsSync(uptimePath)) {
            uptime = parseFloat(fs.readFileSync(uptimePath, 'utf8').split(' ')[0]);
        }
    } catch (e) {}

    // 3. Scan host listening sockets and Caddy proxies
    const listeningPorts = getListeningPorts();
    const caddyProxies = getCaddyProxies();

    // Create a complete port registry map
    const portRegistry = [];

    // Track active listening ports
    const activePortNumbers = new Set(listeningPorts.map(p => p.port));

    // Match Caddy proxies
    for (const proxy of caddyProxies) {
        const isListening = activePortNumbers.has(proxy.port);
        portRegistry.push({
            port: proxy.port,
            application: `Proxy Target: ${proxy.domain}`,
            owner: 'Caddy Route',
            endpoint: proxy.target,
            domain: proxy.domain,
            status: isListening ? 'ONLINE' : 'OFFLINE',
            bindIp: isListening ? (listeningPorts.find(p => p.port === proxy.port).ip) : '-'
        });
    }

    // Add other active listening ports that are not in Caddy file
    for (const active of listeningPorts) {
        const alreadyRegistered = portRegistry.some(p => p.port === active.port);
        if (!alreadyRegistered) {
            let appName = 'Unknown App';
            let ownerName = 'Developer';

            // Tag standard system or guide ports
            if (active.port === 80 || active.port === 443) {
                appName = 'Web Server Gateway';
                ownerName = 'System';
            } else if (active.port === 8001) {
                appName = 'CAI Dev Hub (This Portal)';
                ownerName = 'DevOps';
            } else if (active.port === 22) {
                appName = 'SSH Service';
                ownerName = 'System';
            } else if (active.port === 3000 || active.port === 5000 || active.port === 8080 || active.port === 8000) {
                appName = 'Staging Web Service';
                ownerName = 'Dev Team';
            }

            portRegistry.push({
                port: active.port,
                application: appName,
                owner: ownerName,
                endpoint: `${active.ip}:${active.port}`,
                domain: 'None (Direct IP access)',
                status: 'ONLINE',
                bindIp: active.ip
            });
        }
    }

    // Sort port registry numerically by port number
    portRegistry.sort((a, b) => a.port - b.port);

    // 4. Measure CPU usage and return response
    getCpuUsage((cpuPercent) => {
        res.json({
            system: {
                cpu: cpuPercent.toFixed(1),
                ram: {
                    percent: ramPercent,
                    usedGb: (memUsed / (1024 * 1024 * 1024)).toFixed(2),
                    totalGb: (memTotal / (1024 * 1024 * 1024)).toFixed(2)
                },
                uptime: formatUptime(uptime)
            },
            ports: portRegistry
        });
    });
});

app.listen(PORT, () => {
    console.log(`CAI Dev Hub server running on port ${PORT}`);
});
