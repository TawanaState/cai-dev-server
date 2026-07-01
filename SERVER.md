I've got you. The process for Contabo is very similar to Azure, but with less Microsoft red tape. Contabo gives you a straightforward, raw VPS. We will stick with Caddy and Docker since you're optimizing for RAM and simplicity.

Here is the exact step-by-step for your new Contabo server.

### Step 1: The Contabo Setup & SSH Keys

Contabo gives you a root password by default, but we are switching to SSH keys immediately for security.

**On your local machine terminal (if you haven't already):**

```bash
# Generate the key (skip if you already did this for Azure)
ssh-keygen -t ed25519 -C "contabo-vm-key"
# Print the public key to copy it
cat ~/.ssh/id_ed25519.pub

```

**Connecting and Setting Up the Key:**
Contabo emails you the IP address and the `root` password. We need to log in with the password first to plant your key.

```bash
# Log in using the password provided in your Contabo email
ssh root@<YOUR_CONTABO_IP>

```

**Once logged in (as root):**

```bash
# Create the .ssh directory and set permissions
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Open the authorized_keys file
nano ~/.ssh/authorized_keys

```

*Paste your public key into this file. Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).*

```bash
# Secure the file
chmod 600 ~/.ssh/authorized_keys

```

Now, exit the server (`exit`) and try logging in again `ssh root@<YOUR_CONTABO_IP>`. It should log you in instantly without asking for a password.

---

### Step 2: Disable Password Login (Crucial for Contabo)

Since Contabo servers are heavily targeted by bots trying to guess the default `root` password, we must disable password logins entirely now that your key is working.

**On your Contabo server:**

```bash
# Open the SSH configuration file
nano /etc/ssh/sshd_config

```

Find these lines and change them to `no` (you may need to uncomment them by removing the `#`):

```text
PermitRootLogin prohibit-password
PasswordAuthentication no

```

Save and exit.

```bash
# Restart the SSH service
systemctl restart sshd

```

---

### Step 3: Server Prep (Docker & Caddy)

Since you are running as `root` on Contabo, you don't need `sudo` for every command.

```bash
# 1. Update the system
apt update && apt upgrade -y

# 2. Install Docker
apt install docker.io docker-compose -y
systemctl enable docker
systemctl start docker

# 3. Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install caddy -y

```

---

### Step 4: Map Your Squarespace Domain

This is exactly the same as before.

1. Log into Squarespace.
2. Go to **Domains** -> Click your domain -> **DNS Settings**.
3. Add an **A Record**.
4. Host: **amara** (or whatever you want).
5. Data/IP Address: **<YOUR_CONTABO_IP>**
6. Save.

---

### Step 5: Import & Run Your Project

Let's pull a repository from GitHub and spin it up. We'll use your LogicHQ apps directory.

```bash
# Create a directory for your apps
mkdir -p ~/logichq-apps && cd ~/logichq-apps

# Clone your repo (Assuming it has a Dockerfile)
git clone https://github.com/yourusername/project-amara.git
cd project-amara

# Build and run the Docker container
docker build -t project-amara .
docker run -d --name amara-app -p 8000:8000 project-amara

```

---

### Step 6: Route Traffic & Auto-SSL

Point Caddy at your new container.

```bash
# Open the Caddy configuration file
nano /etc/caddy/Caddyfile

```

Replace everything with:

```text
amara.yourdomain.com {
    reverse_proxy localhost:8000
}

```

Save and exit.

```bash
# Reload Caddy
systemctl reload caddy

```

Your Contabo server is now locked down, running Docker, and serving your app securely over HTTPS.