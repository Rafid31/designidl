# DesigniDL — Token-Gated Download Portal

**DesigniDL** is a static, token-based download portal for [Designi](https://designi.com.br) files. Users activate a time-limited access token to download PSD, PNG, SVG, AI, EPS, MP4, ZIP, PDF, and more — with daily and monthly usage limits.

No backend required. Deploy anywhere that serves static HTML.

---

## 📁 File Structure

```
designidl-app.html   ← User-facing download portal
admin-panel.html     ← Admin token management panel
README.md            ← This file
```

---

## 🔐 How to Set a New Admin Password

1. Open `admin-panel.html` in a text editor
2. Find the line near the top of the `<script>` section:
   ```js
   const ADMIN_PASS = 'DesigniAdmin2024!'; // ⚠ CHANGE BEFORE DEPLOYING
   ```
3. Replace `'DesigniAdmin2024!'` with your own secure password
4. Save and redeploy

---

## 🎟️ How to Add / Manage Tokens

### Option A: Using the Admin Panel (Recommended)

1. Open `admin-panel.html` in your browser
2. Log in with the admin password
3. Fill out the "Generate Token" form:
   - Customer name (optional, for your records)
   - Plan duration (7 / 30 / 90 / 365 days)
   - Daily limit (5 / 20 / 50 / 999)
4. Click **Generate Token**
5. Copy the generated token (e.g. `ABCD-5678-WXYZ`)
6. Send it to your customer

### Option B: Adding Directly to the User App

1. Open `designidl-app.html` in a text editor
2. Find the `TOKEN_DB` object:
   ```js
   const TOKEN_DB = {
     'DEMO-1234-ABCD': { dailyLimit: 20, monthlyLimit: 600, days: 30 },
     // add more here...
   };
   ```
3. Add a new entry with the token ID as the key
4. Save and redeploy

### Option C: Export from Admin Panel

1. In the admin panel, click **Export JSON**
2. This downloads a `tokens.json` file
3. Copy the contents into your `TOKEN_DB` object in `designidl-app.html`

---

## 🚀 How to Deploy to GitHub Pages

1. **Create a GitHub account** at [github.com](https://github.com) (if you don't have one)

2. **Create a new repository**:
   - Click the **+** button → **New repository**
   - Name: `designidl`
   - Visibility: **Public**
   - Click **Create repository**

3. **Upload your files**:
   - Click **Add file** → **Upload files**
   - Drag and drop `designidl-app.html` and `admin-panel.html`
   - Click **Commit changes**

4. **Enable GitHub Pages**:
   - Go to **Settings** → **Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** → **/ (root)**
   - Click **Save**

5. **Wait ~2 minutes** for deployment

6. **Your site is live!**
   - User portal: `https://YOUR-USERNAME.github.io/designidl/designidl-app.html`
   - Admin panel: `https://YOUR-USERNAME.github.io/designidl/admin-panel.html`

---

## 🌐 How to Deploy to Render (Free)

1. Go to [render.com](https://render.com) → **Sign up** (free)

2. Click **New** → **Static Site**

3. Connect your GitHub repository (`designidl`)

4. Configure:
   - **Name**: `designidl`
   - **Branch**: `main`
   - **Publish directory**: `.` (just a dot)

5. Click **Deploy**

6. Render gives you a live URL automatically (e.g. `https://designidl.onrender.com`)

---

## 💰 How to Sell Tokens

1. Open the **Admin Panel** and generate a token
2. Copy the token (e.g. `ABCD-5678-WXYZ`)
3. Send it to your customer via **WhatsApp**, **email**, or **DM**
4. The customer opens the user portal, pastes the token, and starts downloading

### Pricing Suggestion

| Plan     | Daily Limit | Duration | Suggested Price |
|----------|-------------|----------|-----------------|
| Basic    | 5/day       | 30 days  | R$ 19.90       |
| Standard | 20/day      | 30 days  | R$ 39.90       |
| Pro      | 50/day      | 30 days  | R$ 79.90       |

---

## ⚠️ Known Limitation: CORS Protection

Designi uses **CORS protection** on direct file URLs. This means:

- **Some files will download normally** via `fetch()` → Blob → automatic save
- **Some files will be CORS-blocked** by the browser

When a file is CORS-blocked:
1. The history shows an **orange dot** with status "cors"
2. An **"Open ↗"** button appears next to the URL
3. The user clicks "Open ↗" → the file opens in a new tab
4. The user right-clicks → **Save As** to download manually

This is a browser security restriction and cannot be bypassed without a backend proxy server.

---

## 🔒 Security Notes

- **This is a client-side only app.** All tokens are hardcoded in the HTML file or stored in cookies.
- **For production use**, consider:
  - Fetching `TOKEN_DB` from a server-side API (`/api/tokens`)
  - Replacing the admin password with proper authentication
  - Using a backend proxy to handle CORS-restricted downloads
  - Encrypting cookie data

---

## 📝 License

Use freely. Built for the Designi community.
